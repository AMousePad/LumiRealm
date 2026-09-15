import { describe, expect, test } from 'bun:test';
import { createModulePushes, type ModulePushesDeps } from '../../src/state/module-pushes.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';
import type { LiveLoreEntry } from '../../src/core/export/lore-back-projection.js';

function setup(installed = true) {
  const env = {
    id: 'module', module: { lorebook: [{ comment: 'Preset 1', content: 'imported tags', key: '' }] },
    asset_index: {}, ...(installed ? { installed_world_book_id: 'book' } : {}),
  } as unknown as ModuleEnvelope;
  let rows: LiveLoreEntry[] = [];
  const calls: unknown[] = [];
  const pushes = createModulePushes({
    translateLang: 'en', readLumirealm: async () => null,
    writeLumirealm: async () => {}, writeModuleEnvelope: async () => {},
    readGlobalModuleIds: async () => [], listLumirealmCharacters: async () => [],
    listCards: async () => [], pushCards: () => {}, send: () => {},
    readModuleEnvelope: async () => env,
    listModuleStore: async () => [],
    listWorldBookEntries: async (bookId, opts) => {
      calls.push([bookId, opts]);
      return { data: rows.slice(opts.offset, opts.offset + opts.limit) };
    },
    log: { info: () => {}, warn: () => {} }, errMsg: String,
  } as ModulePushesDeps);
  return { env, calls, setRows: (value: LiveLoreEntry[]) => { rows = value; },
    load: async () => (await pushes.loadAttachedModulesForRuntime('user', ['module']))[0]!.lorebook };
}

describe('installed module lorebook runtime source', () => {
  test('reads locally added and edited presets and respects deletion without changing the import', async () => {
    const fixture = setup();
    fixture.setRows([{ comment: 'Preset 2', content: 'neutral blue ink', key: [] }]);
    expect(await fixture.load()).toMatchObject([{ comment: 'Preset 2', content: 'neutral blue ink' }]);
    fixture.setRows([{ comment: 'Preset 2', content: 'neutral pencil', key: [] }]);
    expect(await fixture.load()).toMatchObject([{ comment: 'Preset 2', content: 'neutral pencil' }]);
    fixture.setRows([]);
    expect(await fixture.load()).toEqual([]);
    expect(fixture.env.module.lorebook).toMatchObject([{ content: 'imported tags' }]);
  });

  test('reads all installed pages including a newly appended preset', async () => {
    const fixture = setup();
    fixture.setRows(Array.from({ length: 201 }, (_, index) => ({
      comment: `Preset ${index}`, content: `neutral tag ${index}`, key: [],
    })));
    const rows = await fixture.load();
    expect(rows).toHaveLength(201);
    expect(rows[200]).toMatchObject({ comment: 'Preset 200', content: 'neutral tag 200' });
    expect(fixture.calls).toEqual([
      ['book', { limit: 200, offset: 0, userId: 'user' }],
      ['book', { limit: 200, offset: 200, userId: 'user' }],
    ]);
  });

  test('uses source lore only when no book has been installed', async () => {
    const fixture = setup(false);
    expect(await fixture.load()).toMatchObject([{ content: 'imported tags' }]);
    expect(fixture.calls).toEqual([]);
  });
});
