import { expect, test } from 'bun:test';
import { createModulePushes } from '../../src/state/module-pushes.js';
import type { ModuleEnvelope, ModuleIndexEntry } from '../../src/state/modules-store.js';

test('runtime resolves ids and shared namespaces once in module-library order', async () => {
  const library = [
    { id: 'alias-a', namespace: 'shared' },
    { id: 'direct' },
    { id: 'alias-b', namespace: 'shared' },
    { id: 'unattached' },
  ].map(({ id, namespace }) => ({
    schema_version: 1, id, filename: 'module', uploaded_at: 1, asset_index: {},
    module: { id, name: id, namespace, trigger: [], lorebook: [{ key: id, content: id }] },
  }) as unknown as ModuleEnvelope);
  const pushes = createModulePushes({
    translateLang: 'en', readLumirealm: async () => null, writeLumirealm: async () => {},
    readModuleEnvelope: async (_userId, id) => library.find(entry => entry.id === id) ?? null,
    listModuleStore: async () => library.map(({ id }) => ({ id }) as ModuleIndexEntry),
    listWorldBookEntries: async () => { throw new Error('No module books are installed'); },
    writeModuleEnvelope: async () => {}, readGlobalModuleIds: async () => [],
    listLumirealmCharacters: async () => [], listCards: async () => [], pushCards: () => {}, send: () => {},
    log: { info() {}, warn() {} }, errMsg: String,
  });
  expect(await pushes.loadAttachedModulesForRuntime('user', [])).toEqual([]);
  const loaded = await pushes.loadAttachedModulesForRuntime('user', ['alias-b', 'direct', 'shared', 'direct', 'missing']);
  expect(loaded.map(module => module.id)).toEqual(['alias-a', 'direct', 'alias-b']);
  expect(loaded.map(module => module.lorebook)).toEqual([
    [{ key: 'alias-a', content: 'alias-a' }], [{ key: 'direct', content: 'direct' }], [{ key: 'alias-b', content: 'alias-b' }],
  ]);
});
