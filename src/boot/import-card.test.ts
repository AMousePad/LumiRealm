import { afterEach, describe, expect, test } from 'bun:test';

import type { UserStorageLike } from '../payload/installer.js';
import { writeStoredZip } from '../realm/import-formats/zip-writer.js';
import { createImportCardOrchestrator } from './import-card.js';

function cardBytes(lore: boolean, avatar: boolean): Uint8Array {
  const data: Record<string, unknown> = {
    name: 'Ada',
    description: '',
    personality: '',
    scenario: '',
    first_mes: 'Hello',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '1',
    extensions: {},
  };
  if (lore) {
    data.character_book = {
      entries: [{ keys: ['key'], comment: 'Lore', content: 'Value', insertion_order: 1 }],
    };
  }
  if (avatar) {
    data.assets = [{ type: 'icon', name: 'main', uri: 'embeded://avatar.png', ext: 'png' }];
  }
  const entries = [{
    name: 'card.json',
    data: new TextEncoder().encode(JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data,
    })),
  }];
  if (avatar) entries.push({ name: 'avatar.png', data: Uint8Array.of(1, 2, 3) });
  return writeStoredZip(entries);
}

function memoryStorage(): UserStorageLike {
  const values = new Map<string, unknown>();
  return {
    async getJson<T>(path: string, options?: { fallback?: T }) {
      return (values.has(path) ? values.get(path) : options?.fallback) as T;
    },
    async setJson(path, value) { values.set(path, value); },
    async delete(path) { values.delete(path); },
  };
}

function harness(failures: { worldBook?: boolean; avatar?: boolean } = {}) {
  const trace: string[] = [];
  const characterInputs: Record<string, unknown>[] = [];
  const sent: Array<{ type: string; phase?: string; error?: string }> = [];
  const warnings: string[] = [];
  const worldBookIds = new Map<string, readonly string[]>();
  const spindleMock = {
    characters: {
      async create(input: Record<string, unknown>) {
        trace.push('characters.create');
        characterInputs.push(input);
        return { id: 'char-1' };
      },
      async get() { return null; },
      async update() { trace.push('characters.update'); return { id: 'char-1' }; },
      async list() { return { data: [], total: 0 }; },
      async setAvatar() {
        trace.push('characters.setAvatar');
        if (failures.avatar) throw new Error('avatar failed');
        return { id: 'char-1', image_id: 'avatar-1' };
      },
    },
    world_books: {
      async create() {
        trace.push('world_books.create');
        if (failures.worldBook) throw new Error('world book failed');
        return { id: 'wb-1' };
      },
      async update() { trace.push('world_books.update'); return { id: 'wb-1' }; },
      entries: {
        async create() { trace.push('world_books.entries.create'); return { id: 'entry-1' }; },
      },
    },
    images: {
      async upload() { trace.push('images.upload'); return { id: 'single-1' }; },
      async uploadMany(items: readonly unknown[]) {
        trace.push('images.uploadMany');
        return items.map((_, index) => ({ id: `asset-${index + 1}` }));
      },
    },
    regex_scripts: {},
  };
  (globalThis as { spindle?: unknown }).spindle = spindleMock;
  const orchestrator = createImportCardOrchestrator({
    extensionVersion: 'test',
    userStorage: memoryStorage,
    requestConsent: async () => ({ confirmed: true }),
    worldBookIdsByCharacter: worldBookIds,
    pendingImportCompletions: new Map(),
    enterAssetUpload: () => {},
    exitAssetUpload: () => {},
    nudgeGc: () => {},
    refreshRisuAssetMap: async () => {},
    send: (message) => sent.push(message as typeof sent[number]),
    listCards: async () => [],
    pushCards: () => {},
    toastFor: (_userId, _kind, message) => warnings.push(message),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  });
  return { orchestrator, trace, characterInputs, sent, warnings, worldBookIds };
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('card import current APIs', () => {
  test('delegates through current APIs in supported-host order', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(cardBytes(true, true), 'card.charx', 'user-1');

    expect(h.trace).toEqual([
      'world_books.create',
      'characters.create',
      'world_books.update',
      'characters.setAvatar',
      'images.uploadMany',
      'world_books.entries.create',
      'characters.update',
    ]);
    expect(h.characterInputs[0]?.world_book_ids).toEqual(['wb-1']);
    expect(h.worldBookIds.get('char-1')).toEqual(['wb-1']);
    expect(h.sent.some((message) => message.phase === 'done')).toBe(true);
  });

  test('does not call lore or avatar APIs when card data omits them', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(cardBytes(false, false), 'card.charx', 'user-1');

    expect(h.trace).toEqual(['characters.create', 'characters.update']);
    expect(h.characterInputs[0]?.world_book_ids).toBeUndefined();
    expect(h.worldBookIds.size).toBe(0);
    expect(h.warnings).toEqual([]);
  });

  test('keeps world-book and avatar RPC failures nonfatal', async () => {
    const h = harness({ worldBook: true, avatar: true });
    await h.orchestrator.importCardFromBytes(cardBytes(true, true), 'card.charx', 'user-1');

    expect(h.trace).toEqual([
      'world_books.create',
      'characters.create',
      'characters.setAvatar',
      'images.uploadMany',
      'characters.update',
    ]);
    expect(h.characterInputs[0]?.world_book_ids).toBeUndefined();
    expect(h.warnings).toEqual([
      'Failed to create world book: world book failed. Lorebook entries skipped.',
      'Failed to set character avatar: avatar failed',
    ]);
    expect(h.sent.some((message) => message.phase === 'done')).toBe(true);
    expect(h.sent.some((message) => message.phase === 'error')).toBe(false);
  });
});
