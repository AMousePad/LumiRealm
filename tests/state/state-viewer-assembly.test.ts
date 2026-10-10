import { describe, test, expect } from 'bun:test';
import {
  createViewerAssembly,
  type ViewerAssemblyDeps,
} from '../../src/state/viewer-assembly.js';

interface MockState {
  readonly readLumirealmCalls: Array<{ characterId: string; userId: string }>;
  readonly readModuleCalls: Array<{ moduleId: string; userId: string }>;
  readonly fetchCharacterCalls: Array<{ characterId: string; userId: string }>;
  readonly listEntriesCalls: Array<{ wbId: string; offset: number }>;
  readonly warns: string[];
}

function makeMockDeps(overrides?: Partial<ViewerAssemblyDeps>): {
  deps: ViewerAssemblyDeps;
  state: MockState;
} {
  const state: MockState = {
    readLumirealmCalls: [],
    readModuleCalls: [],
    fetchCharacterCalls: [],
    listEntriesCalls: [],
    warns: [],
  };
  const deps: ViewerAssemblyDeps = {
    readLumirealm: async (characterId, userId) => {
      state.readLumirealmCalls.push({ characterId, userId });
      return null;
    },
    readModule: async (moduleId, userId) => {
      state.readModuleCalls.push({ moduleId, userId });
      return null;
    },
    fetchCharacter: async (characterId, userId) => {
      state.fetchCharacterCalls.push({ characterId, userId });
      return null;
    },
    fetchWorldBookMeta: async () => null,
    listWorldBookEntries: async (wbId, opts) => {
      state.listEntriesCalls.push({ wbId, offset: opts.offset });
      return { data: [] };
    },
    translateLang: 'en',
    log: { warn: (m) => state.warns.push(m) },
    errMsg: (e) => e instanceof Error ? e.message : String(e),
    ...overrides,
  };
  return { deps, state };
}

const MIN_LUMI_DATA = {
  schema_version: 1 as const,
  translator_version: '0.1.0',
  payload: {
    requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
    triggers: [],
    lua_scripts: [],
    background_html: null,
    utility_bot: false,
    scriptstate_defaults: {},
    extra: {},
  },
  imported_at: 0,
  asset_index: {},
  emotion_index: {},
  user_overrides: {},
  regex_scripts: [],
};

describe('createViewerAssembly: assembleModule', () => {
  test('returns null when readModule returns null', async () => {
    const { deps, state } = makeMockDeps();
    const va = createViewerAssembly(deps);
    const result = await va.assembleModule('m-1', 'u-1');
    expect(result).toBeNull();
    expect(state.readModuleCalls).toEqual([{ moduleId: 'm-1', userId: 'u-1' }]);
  });
});

describe('createViewerAssembly: assembleCharacter', () => {
  test('returns null when readLumirealm returns null', async () => {
    const { deps, state } = makeMockDeps();
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).toBeNull();
    expect(state.readLumirealmCalls).toEqual([{ characterId: 'c-1', userId: 'u-1' }]);
    expect(state.fetchCharacterCalls).toEqual([]);
    expect(state.readModuleCalls).toEqual([]);
  });

  test('returns null when readLumirealm returns data:null', async () => {
    const { deps } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'X' },
        data: null,
        risuai: {},
      }) as never,
    });
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).toBeNull();
  });

  test('happy path with no world books builds viewer data', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: MIN_LUMI_DATA,
        risuai: {},
      }) as never,
      fetchCharacter: async (characterId, userId) => {
        state.fetchCharacterCalls.push({ characterId, userId });
        return { world_book_ids: [] };
      },
    });
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).not.toBeNull();
    expect(state.fetchCharacterCalls).toEqual([{ characterId: 'c-1', userId: 'u-1' }]);
    expect(state.listEntriesCalls).toEqual([]);
  });

  test('walks attached module ids for translation merging', async () => {
    const dataWithModules = {
      ...MIN_LUMI_DATA,
      user_overrides: { attached_module_ids: ['m-a', 'm-b'] },
    };
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: dataWithModules,
        risuai: {},
      }) as never,
      fetchCharacter: async (characterId, userId) => {
        state.fetchCharacterCalls.push({ characterId, userId });
        return { world_book_ids: [] };
      },
    });
    const va = createViewerAssembly(deps);
    await va.assembleCharacter('c-1', 'u-1');
    const moduleIds = state.readModuleCalls.map((c) => c.moduleId);
    expect(moduleIds).toContain('m-a');
    expect(moduleIds).toContain('m-b');
  });

  test('logs warn when readModule throws during translation collection', async () => {
    const dataWithModules = {
      ...MIN_LUMI_DATA,
      user_overrides: { attached_module_ids: ['m-broken'] },
    };
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: dataWithModules,
        risuai: {},
      }) as never,
      fetchCharacter: async () => ({ world_book_ids: [] }),
      readModule: async () => { throw new Error('disk-fail'); },
    });
    const va = createViewerAssembly(deps);
    await va.assembleCharacter('c-1', 'u-1');
    expect(state.warns.some((w) => w.includes('m-broken') && w.includes('disk-fail'))).toBe(true);
  });

  test('paginates world book entries by 200 increments', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: MIN_LUMI_DATA,
        risuai: {},
      }) as never,
      fetchCharacter: async () => ({ world_book_ids: ['wb-1'] }),
      fetchWorldBookMeta: async () => ({ name: 'WB Alpha' }),
      listWorldBookEntries: async (wbId, opts) => {
        state.listEntriesCalls.push({ wbId, offset: opts.offset });
        if (opts.offset === 0) return { data: new Array(200).fill({ id: 'e-x', key: ['k'], content: '' }) };
        return { data: new Array(50).fill({ id: 'e-y', key: ['k'], content: '' }) };
      },
    });
    const va = createViewerAssembly(deps);
    await va.assembleCharacter('c-1', 'u-1');
    expect(state.listEntriesCalls).toEqual([
      { wbId: 'wb-1', offset: 0 },
      { wbId: 'wb-1', offset: 200 },
    ]);
  });

  test('fetchCharacter throws produces empty world books, no abort', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: MIN_LUMI_DATA,
        risuai: {},
      }) as never,
      fetchCharacter: async () => { throw new Error('charget-fail'); },
    });
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).not.toBeNull();
    expect(state.listEntriesCalls).toEqual([]);
  });

  test('per-wb isolation: one wb meta failure does not block others', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: MIN_LUMI_DATA,
        risuai: {},
      }) as never,
      fetchCharacter: async () => ({ world_book_ids: ['wb-bad', 'wb-ok'] }),
      fetchWorldBookMeta: async (wbId) => {
        if (wbId === 'wb-bad') throw new Error('bad-meta');
        return { name: 'WB Alpha' };
      },
      listWorldBookEntries: async (wbId, opts) => {
        state.listEntriesCalls.push({ wbId, offset: opts.offset });
        return { data: [] };
      },
    });
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).not.toBeNull();
    expect(state.listEntriesCalls).toEqual([{ wbId: 'wb-ok', offset: 0 }]);
  });

  test('non-string wb_ids filtered out', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: MIN_LUMI_DATA,
        risuai: {},
      }) as never,
      fetchCharacter: async () => ({ world_book_ids: ['wb-good', 42, null, 'wb-also-good'] as never }),
      fetchWorldBookMeta: async () => ({ name: 'WB' }),
      listWorldBookEntries: async (wbId, opts) => {
        state.listEntriesCalls.push({ wbId, offset: opts.offset });
        return { data: [] };
      },
    });
    const va = createViewerAssembly(deps);
    await va.assembleCharacter('c-1', 'u-1');
    const visited = state.listEntriesCalls.map((c) => c.wbId);
    expect(visited).toEqual(['wb-good', 'wb-also-good']);
  });

  test('character translation overrides world book name when char name matches', async () => {
    const dataWithTranslation = {
      ...MIN_LUMI_DATA,
      translations: { en: { name: 'Char EN' } },
    };
    const { deps } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Char' },
        data: dataWithTranslation,
        risuai: {},
      }) as never,
      fetchCharacter: async () => ({ world_book_ids: ['wb-1'] }),
      fetchWorldBookMeta: async () => ({ name: 'Char  - lore' }),
    });
    const va = createViewerAssembly(deps);
    const result = await va.assembleCharacter('c-1', 'u-1');
    expect(result).not.toBeNull();
  });
});
