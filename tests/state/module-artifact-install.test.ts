import { afterEach, expect, test } from 'bun:test';
import { createWorldBookOps } from '../../src/state/world-book-ops.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

afterEach(() => { delete (globalThis as { spindle?: unknown }).spindle; });

test('global and attached regex projection preserves stable IDs and migrated aliases without duplicate lore payloads', async () => {
  const sent: BackendToFrontend[] = [];
  let books = ['existing'];
  (globalThis as { spindle?: unknown }).spindle = { world_books: {
    getGlobal: async () => books, setGlobal: async (value: string[]) => { books = value; },
  } };
  const ops = createWorldBookOps({ charactersAttachedTo: async () => [], send: message => { sent.push(message); },
    log: { info() {}, warn() {} }, errMsg: String });
  const env = { id: 'module', installed_world_book_id: 'book', module: { name: 'Module', regex: [
    { comment: 'rule', in: 'before', out: 'after', type: 'editdisplay', flag: 'g', ableFlag: true },
  ] } } as unknown as ModuleEnvelope;
  const options = { stableIdPrefix: 'stable', legacyScriptIdsBySourceRow: new Map([[0, 'Old-ID']]) };
  await ops.dispatchModuleArtifactInstall('character', env, undefined, options);
  expect(await ops.dispatchGlobalModuleArtifactInstall(env, undefined, options)).toEqual({ worldBookId: 'book' });
  expect(books).toEqual(['existing', 'book']);
  expect(await ops.dispatchGlobalModuleArtifactInstall(env, undefined, options)).toEqual({ worldBookId: null });
  for (const message of sent) {
    expect(message.type).toBe('install_module_artifacts');
    if (message.type !== 'install_module_artifacts') throw new Error('Unexpected message');
    expect(message).not.toHaveProperty('lorebookEntries');
    expect(message.regexScripts).toHaveLength(1);
    expect(message.regexScripts[0]).toMatchObject({ script_id: 'stable_0', metadata: { imported_script_id: 'old_id' },
      scope: message.characterId === null ? 'global' : 'character', scope_id: message.characterId });
  }
});
