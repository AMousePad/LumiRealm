import { afterEach, expect, test } from 'bun:test';
import { createOrphanHandlers } from '../../src/handlers/orphan';
import { createOrphanOrchestrator, type OrphanOrchestratorDeps } from '../../src/state/orphan-orchestrator';
import { makeSpindleHost } from '../../src/interpreter/spindle-host';
import type { OrphanDetectDeps } from '../../src/state/orphan-detect';

const original = (globalThis as any).spindle;
afterEach(() => { (globalThis as any).spindle = original; });
const live: OrphanDetectDeps = {
  listLumirealmCharacters: async () => [], listModules: async () => [],
  listActiveCharacterJournals: async () => [], listActiveModuleJournals: async () => [],
  characterExists: async () => false, moduleExists: async () => false,
};
const log = { info() {}, warn() {}, error() {} };

test('generated and uploaded inlays carry the originating chat owner', async () => {
  const calls: unknown[] = [];
  (globalThis as any).spindle = {
    generate: { raw() {} },
    imageGen: { generate: async (input: unknown) => { calls.push(input); return { imageId: 'generated' }; } },
    images: { uploadFromDataUrl: async (...args: unknown[]) => { calls.push(args); return { id: 'uploaded' }; } },
  };
  const api = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'owner' });
  await api.imageGen!.generate('scene');
  await api.images!.uploadFromDataUrl('data:image/png;base64,AA==', 'inlay');
  expect(calls[0]).toMatchObject({ owner_chat_id: 'chat', userId: 'owner' });
  expect(calls[1]).toEqual(['data:image/png;base64,AA==', { originalFilename: 'inlay', owner_chat_id: 'chat', userId: 'owner' }]);
});

test('orphan scans exclude chat-owned images that have no imported asset reference', async () => {
  const scan = createOrphanOrchestrator({
    imagesApi: { list: async () => ({ data: [{ id: 'inlay', owner_chat_id: 'chat' }, { id: 'orphan' }], total: 2 }) },
    regexApi: { list: async () => ({ data: [], total: 0 }) },
    buildOrphanDetectDeps: () => live,
    listLumirealmCharacterIds: async () => [], listModuleIds: async () => [],
    countCharacterRepair: async () => ({ charactersToRetranslate: 0, modulesToReattach: 0, danglingModuleRefs: 0 }),
    log, errMsg: String,
  } as unknown as OrphanOrchestratorDeps);
  expect((await scan.scanOrphanedImages('owner')).orphans.map(image => image.id)).toEqual(['orphan']);
});

test('deletion rechecks chat ownership even when the selected ID is from a stale scan', async () => {
  const deleted: string[] = [];
  const handlers = createOrphanHandlers({
    assetUploadsInFlightRef: { current: 0 },
    scanOrphanedImages: async () => { throw new Error('Unexpected scan'); },
    buildOrphanDetectDeps: () => live,
    getImage: async (id: string, userId: string) => { expect(userId).toBe('owner'); return { owner_chat_id: id === 'inlay' ? 'chat' : null }; },
    deleteImageIds: async ids => { deleted.push(...ids); return { deleted: ids.length, absent: 0, failed: 0 }; },
    emitOperationProgress() {}, log, errMsg: String,
  });
  await handlers.delete_orphan_assets({ type: 'delete_orphan_assets', imageIds: ['inlay', 'orphan'] }, { userId: 'owner', send() {}, log, errMsg: String });
  expect(deleted).toEqual(['orphan']);
});
