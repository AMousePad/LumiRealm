import { describe, test, expect } from 'bun:test';
import {
  createLorebookImporter,
  type LorebookImporterDeps,
} from '../../src/state/lorebook-import.js';
import type { BackendToFrontend } from '../../src/types/messages.js';
import type { DirectLorebookParse } from '../../src/payload/lorebook-direct-import.js';
import type { LumiWorldBookEntry } from '../../src/core/lumiverse/types.js';
import type { LoreBook } from '../../src/core/schemas/lorebook.js';

interface MockState {
  sentMessages: Array<{ msg: BackendToFrontend; userId: string }>;
  warns: string[];
  infos: string[];
  createdWorldBooks: Array<{ name: string; userId: string }>;
  characterUpdates: Array<{ characterId: string; ids: readonly string[]; userId: string }>;
  entryWrites: Array<{ bookId: string; input: Record<string, unknown>; userId: string }>;
  readLumirealmCalls: Array<{ characterId: string; userId: string }>;
  parseCalls: number;
  mapCalls: Array<{ entriesLen: number; worldBookId: string }>;
}

function entryStub(over: Partial<LumiWorldBookEntry> = {}): LumiWorldBookEntry {
  return {
    id: 'e-id',
    world_book_id: 'wb',
    uid: 'uid',
    key: ['k1'],
    keysecondary: [],
    content: 'body',
    comment: 'cm',
    position: 0,
    depth: 0,
    role: null,
    order_value: 100,
    selective: false,
    constant: false,
    disabled: false,
    group_name: '',
    group_override: false,
    group_weight: 0,
    probability: 100,
    scan_depth: null,
    case_sensitive: false,
    match_whole_words: false,
    automation_id: null,
    use_regex: false,
    prevent_recursion: false,
    exclude_recursion: false,
    delay_until_recursion: false,
    priority: 0,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: false,
    vectorized: false,
    vector_index_status: 'pending',
    vector_indexed_at: null,
    vector_index_error: null,
    extensions: {},
    created_at: 0,
    updated_at: 0,
    ...over,
  } as LumiWorldBookEntry;
}

function loreBookStub(over: Partial<LoreBook> = {}): LoreBook {
  return {
    key: 'k',
    content: 'body',
    comment: 'cm',
    selective: false,
    constant: false,
    insertorder: 100,
    activationPercent: 100,
    ...over,
  } as LoreBook;
}

function makeMockDeps(overrides: {
  parsed?: DirectLorebookParse;
  mapped?: readonly LumiWorldBookEntry[];
  readLumirealm?: LorebookImporterDeps['readLumirealm'];
  createWorldBook?: LorebookImporterDeps['createWorldBook'];
  updateCharacterWorldBookIds?: LorebookImporterDeps['updateCharacterWorldBookIds'];
  createWorldBookEntry?: LorebookImporterDeps['createWorldBookEntry'];
} = {}): { deps: LorebookImporterDeps; state: MockState } {
  const state: MockState = {
    sentMessages: [],
    warns: [],
    infos: [],
    createdWorldBooks: [],
    characterUpdates: [],
    entryWrites: [],
    readLumirealmCalls: [],
    parseCalls: 0,
    mapCalls: [],
  };
  const parsed: DirectLorebookParse = overrides.parsed ?? {
    entries: [loreBookStub()],
    dropped: 0,
    format: 'risu',
  };
  const mapped: readonly LumiWorldBookEntry[] = overrides.mapped ?? [entryStub()];
  const deps: LorebookImporterDeps = {
    readLumirealm: overrides.readLumirealm ?? (async (characterId, userId) => {
      state.readLumirealmCalls.push({ characterId, userId });
      return null;
    }),
    createWorldBook: overrides.createWorldBook ?? (async (input, userId) => {
      state.createdWorldBooks.push({ name: input.name, userId });
      return { id: `wb-${state.createdWorldBooks.length}` };
    }),
    updateCharacterWorldBookIds: overrides.updateCharacterWorldBookIds ?? (async (characterId, ids, userId) => {
      state.characterUpdates.push({ characterId, ids, userId });
    }),
    createWorldBookEntry: overrides.createWorldBookEntry ?? (async (bookId, input, userId) => {
      state.entryWrites.push({ bookId, input, userId });
      return { id: `e-${state.entryWrites.length}` };
    }),
    send: (msg, userId) => state.sentMessages.push({ msg, userId }),
    log: {
      info: (m) => state.infos.push(m),
      warn: (m) => state.warns.push(m),
    },
    errMsg: (e) => (e instanceof Error ? e.message : String(e)),
    parseDirectLorebook: (() => {
      state.parseCalls += 1;
      return parsed;
    }) as never,
    mapLoreBook: ((entries: readonly LoreBook[], opts: { worldBookId: string }) => {
      state.mapCalls.push({ entriesLen: entries.length, worldBookId: opts.worldBookId });
      return mapped as LumiWorldBookEntry[];
    }) as never,
  };
  return { deps, state };
}

const STANDALONE_MSG = {
  type: 'import_lorebook' as const,
  characterId: null,
  json: '{}',
  filename: 'mybook.json',
};

const PER_CHAR_MSG = {
  type: 'import_lorebook' as const,
  characterId: 'c-1',
  json: '{}',
  filename: 'mybook.json',
};

describe('createLorebookImporter: parse failures', () => {
  test('format=unknown sends error result, no world_book ops', async () => {
    const { deps, state } = makeMockDeps({
      parsed: { entries: [], dropped: 3, format: 'unknown' },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([]);
    expect(state.characterUpdates).toEqual([]);
    expect(state.entryWrites).toEqual([]);
    expect(state.sentMessages).toHaveLength(1);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.type).toBe('lorebook_import_result');
    expect(m.ok).toBe(false);
    expect(m.written).toBe(0);
    expect(m.dropped).toBe(3);
    expect(m.characterId).toBeNull();
    expect(m.reason).toContain('unrecognized lorebook format');
  });

  test('empty entries sends error result, no world_book ops', async () => {
    const { deps, state } = makeMockDeps({
      parsed: { entries: [], dropped: 1, format: 'risu' },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([]);
    expect(state.entryWrites).toEqual([]);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.dropped).toBe(1);
    expect(m.reason).toContain('no entries');
  });
});

describe('createLorebookImporter: standalone path', () => {
  test('createWorldBook succeeds, writes entries, sends ok result', async () => {
    const { deps, state } = makeMockDeps({
      parsed: { entries: [loreBookStub({ comment: 'A' })], dropped: 0, format: 'risu' },
      mapped: [entryStub({ comment: 'A' })],
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([{ name: 'mybook', userId: 'u-1' }]);
    expect(state.entryWrites).toHaveLength(1);
    expect(state.entryWrites[0]!.bookId).toBe('wb-1');
    expect(state.characterUpdates).toEqual([]);
    const m = state.sentMessages[state.sentMessages.length - 1]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(true);
    expect(m.written).toBe(1);
    expect(m.worldBookId).toBe('wb-1');
    expect(m.worldBookName).toBe('mybook');
    expect(m.characterId).toBeNull();
  });

  test('strips file extension for stem, falls back to "lorebook"', async () => {
    const { deps, state } = makeMockDeps();
    const importer = createLorebookImporter(deps);
    await importer.handle({ ...STANDALONE_MSG, filename: 'foo.bar.lorebook.json' }, 'u-1');
    expect(state.createdWorldBooks[0]!.name).toBe('foo.bar.lorebook');
  });

  test('missing filename falls back to "lorebook"', async () => {
    const { deps, state } = makeMockDeps();
    const importer = createLorebookImporter(deps);
    await importer.handle({ type: 'import_lorebook', characterId: null, json: '{}' }, 'u-1');
    expect(state.createdWorldBooks[0]!.name).toBe('lorebook');
  });

  test('createWorldBook throws, sends error result, no entries written', async () => {
    const { deps, state } = makeMockDeps({
      createWorldBook: async () => { throw new Error('bad'); },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.entryWrites).toEqual([]);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.reason).toContain('world_book create failed: bad');
    expect(m.characterId).toBeNull();
  });
});

describe('createLorebookImporter: per-character path', () => {
  test('readLumirealm null sends error result, no world_book ops', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => null,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([]);
    expect(state.characterUpdates).toEqual([]);
    expect(state.entryWrites).toEqual([]);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.reason).toContain('not a lumirealm character');
    expect(m.characterId).toBe('c-1');
  });

  test('readLumirealm returns data:null sends error result', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'X' },
        data: null,
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([]);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.reason).toContain('not a lumirealm character');
  });

  test('existing world_book reused, no create, no character update', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Hero', world_book_ids: ['wb-existing'] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([]);
    expect(state.characterUpdates).toEqual([]);
    expect(state.entryWrites[0]!.bookId).toBe('wb-existing');
    const m = state.sentMessages[state.sentMessages.length - 1]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(true);
    expect(m.worldBookId).toBe('wb-existing');
    expect(m.worldBookName).toBe('Hero  - lore');
  });

  test('no existing world_book creates new + updates character world_book_ids', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Hero', world_book_ids: [] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.createdWorldBooks).toEqual([
      { name: 'Hero  - lore (imported)', userId: 'u-1' },
    ]);
    expect(state.characterUpdates).toEqual([
      { characterId: 'c-1', ids: ['wb-1'], userId: 'u-1' },
    ]);
    expect(state.entryWrites[0]!.bookId).toBe('wb-1');
    const m = state.sentMessages[state.sentMessages.length - 1]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(true);
    expect(m.worldBookId).toBe('wb-1');
    expect(m.worldBookName).toBe('Hero  - lore (imported)');
  });

  test('no existing + create fails sends error', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Hero', world_book_ids: [] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
      createWorldBook: async () => { throw new Error('upstream down'); },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.characterUpdates).toEqual([]);
    expect(state.entryWrites).toEqual([]);
    const m = state.sentMessages[0]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.reason).toContain('world_book create failed: upstream down');
  });

  test('character with null name uses "character" placeholder', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: null, world_book_ids: [] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.createdWorldBooks[0]!.name).toBe('character  - lore (imported)');
  });

  test('appends new wb id to existing world_book_ids in character update', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'Hero', world_book_ids: [] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.characterUpdates[0]!.ids).toEqual(['wb-1']);
  });
});

describe('createLorebookImporter: entry-write loop', () => {
  test('mixed success + failures: counted, ok=true if any written', async () => {
    let call = 0;
    const { deps, state } = makeMockDeps({
      mapped: [
        entryStub({ comment: 'A' }),
        entryStub({ comment: 'B' }),
        entryStub({ comment: 'C' }),
      ],
      createWorldBookEntry: async (bookId, input, userId) => {
        call += 1;
        if (call === 2) throw new Error('bad entry');
        state.entryWrites.push({ bookId, input, userId });
        return { id: `e-${call}` };
      },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.entryWrites).toHaveLength(2);
    const m = state.sentMessages[state.sentMessages.length - 1]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(true);
    expect(m.written).toBe(2);
    expect(m.dropped).toBe(1);
  });

  test('all entries fail: ok=false with explanatory reason', async () => {
    const { deps, state } = makeMockDeps({
      mapped: [entryStub({ comment: 'A' }), entryStub({ comment: 'B' })],
      createWorldBookEntry: async () => { throw new Error('all bad'); },
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    const m = state.sentMessages[state.sentMessages.length - 1]!.msg as Extract<BackendToFrontend, { type: 'lorebook_import_result' }>;
    expect(m.ok).toBe(false);
    expect(m.written).toBe(0);
    expect(m.dropped).toBe(2);
    expect(m.reason).toContain('all entry writes failed');
    expect(m.worldBookId).toBe('wb-1');
  });

  test('forwards every LumiWorldBookEntry field to createWorldBookEntry', async () => {
    const lumi = entryStub({
      key: ['k1', 'k2'],
      keysecondary: ['ks1'],
      content: 'body content',
      comment: 'name',
      position: 4,
      depth: 2,
      order_value: 250,
      selective: true,
      constant: true,
      disabled: false,
      group_name: 'grp',
      group_override: true,
      group_weight: 50,
      probability: 75,
      case_sensitive: true,
      match_whole_words: true,
      use_regex: true,
      prevent_recursion: true,
      exclude_recursion: true,
      delay_until_recursion: false,
      priority: 9,
      sticky: 3,
      cooldown: 4,
      delay: 5,
      selective_logic: 1,
      use_probability: true,
      role: 'system',
      scan_depth: 7,
      automation_id: 'auto-1',
      extensions: { foo: 'bar' },
    });
    const { deps, state } = makeMockDeps({ mapped: [lumi] });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    const input = state.entryWrites[0]!.input;
    expect(input).toEqual({
      key: ['k1', 'k2'],
      keysecondary: ['ks1'],
      content: 'body content',
      comment: 'name',
      position: 4,
      depth: 2,
      order_value: 250,
      selective: true,
      constant: true,
      disabled: false,
      group_name: 'grp',
      group_override: true,
      group_weight: 50,
      probability: 75,
      case_sensitive: true,
      match_whole_words: true,
      use_regex: true,
      prevent_recursion: true,
      exclude_recursion: true,
      delay_until_recursion: false,
      priority: 9,
      sticky: 3,
      cooldown: 4,
      delay: 5,
      selective_logic: 1,
      use_probability: true,
      role: 'system',
      scan_depth: 7,
      automation_id: 'auto-1',
      extensions: { foo: 'bar' },
    });
  });

  test('omits role/scan_depth/automation_id when null', async () => {
    const lumi = entryStub({ role: null, scan_depth: null, automation_id: null });
    const { deps, state } = makeMockDeps({ mapped: [lumi] });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    const input = state.entryWrites[0]!.input;
    expect('role' in input).toBe(false);
    expect('scan_depth' in input).toBe(false);
    expect('automation_id' in input).toBe(false);
  });

  test('omits extensions when falsy (empty record still forwarded since truthy)', async () => {
    const lumi = entryStub({ extensions: {} });
    const { deps, state } = makeMockDeps({ mapped: [lumi] });
    const importer = createLorebookImporter(deps);
    await importer.handle(STANDALONE_MSG, 'u-1');
    expect(state.entryWrites[0]!.input['extensions']).toEqual({});
  });

  test('mapLoreBook called with target wb id', async () => {
    const { deps, state } = makeMockDeps({
      readLumirealm: async () => ({
        character: { id: 'c-1', name: 'X', world_book_ids: ['wb-existing'] },
        data: { user_overrides: {} },
        risuai: {},
      }) as never,
    });
    const importer = createLorebookImporter(deps);
    await importer.handle(PER_CHAR_MSG, 'u-1');
    expect(state.mapCalls).toEqual([{ entriesLen: 1, worldBookId: 'wb-existing' }]);
  });
});
