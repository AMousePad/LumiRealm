/**
 * Lumirealm character extensions — read/write helper unit tests.
 *
 * Covers `readLumirealm` / `writeLumirealm` / `updateLumirealm` /
 * `clearLumirealm` / `listLumirealmCharacters` / `mergeUserOverrides`
 * against a mock Spindle that mimics the real `worker-host.ts:4406-4448`
 * shallow-merge semantics.
 *
 * The mock is the load-bearing piece: it reproduces the
 * `mergedExtensions = { ...existing.extensions, ...input.extensions }`
 * behavior that determines how `lumirealm: null` round-trips. Without
 * matching that semantic, the soft-remove path's null-sentinel
 * regression test would be useless.
 *
 * No live Lumi dependency. Run with `bun test`.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  readLumirealm,
  writeLumirealm,
  updateLumirealm,
  clearLumirealm,
  listLumirealmCharacters,
  mergeUserOverrides,
  buildAttachModulePatch,
  buildDetachModulesPatch,
  buildSyntheticStoredCard,
  type CharacterDTOLike,
  type SpindleCharactersApi,
} from '../../src/state/lumirealm-character.js';
import { buildLumirealmData } from '../../src/payload/codec.js';
import {
  LUMIREALM_EXT_KEY,
  type LumirealmCharacterData,
  type LumirealmUserOverrides,
  type RisuPayload,
} from '../../src/payload/types.js';

// ─── Mock Spindle that mirrors worker-host.ts shallow-merge ─────────────

interface MockChar {
  id: string;
  name: string;
  extensions: Record<string, unknown>;
}

function makeMockSpindle(): SpindleCharactersApi & {
  _chars: Map<string, MockChar>;
  _seedRisuai(charId: string, risuai: Record<string, unknown>): void;
  _seedExtension(charId: string, key: string, value: unknown): void;
  _put(char: MockChar): void;
} {
  const chars = new Map<string, MockChar>();
  return {
    _chars: chars,
    _seedRisuai(charId, risuai) {
      const c = chars.get(charId);
      if (!c) throw new Error(`mock: no character ${charId}`);
      c.extensions['risuai'] = risuai;
    },
    _seedExtension(charId, key, value) {
      const c = chars.get(charId);
      if (!c) throw new Error(`mock: no character ${charId}`);
      c.extensions[key] = value;
    },
    _put(char) {
      chars.set(char.id, char);
    },
    async get(characterId) {
      const c = chars.get(characterId);
      if (!c) return null;
      return {
        id: c.id,
        name: c.name,
        extensions: { ...c.extensions },
      } as CharacterDTOLike;
    },
    async update(characterId, input) {
      const existing = chars.get(characterId);
      if (!existing) throw new Error('Character not found');
      // Match Lumi worker-host.ts:4433 shallow-merge.
      if (input.extensions !== undefined) {
        existing.extensions = {
          ...existing.extensions,
          ...input.extensions,
        };
      }
      return {
        id: existing.id,
        name: existing.name,
        extensions: { ...existing.extensions },
      } as CharacterDTOLike;
    },
    async list(options) {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;
      const all = [...chars.values()];
      const slice = all.slice(offset, offset + limit);
      return {
        data: slice.map((c) => ({
          id: c.id,
          name: c.name,
          extensions: { ...c.extensions },
        })) as CharacterDTOLike[],
        total: all.length,
      };
    },
  };
}

function makePayload(overrides: Partial<RisuPayload> = {}): RisuPayload {
  return {
    triggers: [],
    lua_scripts: [],
    at_actions: [],
    background_html: null,
    virtualscript: null,
    utility_bot: false,
    scriptstate_defaults: {},
    additional_assets: [],
    emotion_images: [],
    extra: {},
    translator_version: 'test-1.2.3',
    risu_spec_version: 'risu-1.12.3',
    requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    ...overrides,
  };
}

function makeData(): LumirealmCharacterData {
  return buildLumirealmData(makePayload(), '0.1.0');
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('readLumirealm', () => {
  let api: ReturnType<typeof makeMockSpindle>;

  beforeEach(() => { api = makeMockSpindle(); });

  test('returns null when the character does not exist', async () => {
    const r = await readLumirealm(api, 'nonexistent', 'user-1');
    expect(r).toBeNull();
  });

  test('returns { character, data: null, risuai: {} } for a non-lumirealm character', async () => {
    api._put({ id: 'c-1', name: 'Plain', extensions: {} });
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r).not.toBeNull();
    expect(r!.character.id).toBe('c-1');
    expect(r!.data).toBeNull();
    expect(r!.risuai).toEqual({});
  });

  test('round-trips a freshly-written blob with current runtime ownership declarations', async () => {
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    const data = makeData();
    await writeLumirealm(api, 'c-1', data, 'user-1');
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r).not.toBeNull();
    expect(r!.data).toEqual({
      ...data,
      display_owner: true,
    });
  });

  test('exposes the risuai blob alongside the lumirealm blob', async () => {
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    api._seedRisuai('c-1', { backgroundHTML: '<div>bg</div>', utilityBot: true });
    await writeLumirealm(api, 'c-1', makeData(), 'user-1');
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r!.risuai).toEqual({ backgroundHTML: '<div>bg</div>', utilityBot: true });
  });

  test('treats the soft-remove null sentinel as absent (Lumi shallow-merge writes null verbatim)', async () => {
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    await writeLumirealm(api, 'c-1', makeData(), 'user-1');
    await clearLumirealm(api, 'c-1', 'user-1');
    // After clearLumirealm, Lumi shallow-merge keeps the key with literal
    // null. We treat that as absent so the soft-remove path doesn't
    // accidentally re-activate.
    const stored = api._chars.get('c-1');
    expect(stored!.extensions[LUMIREALM_EXT_KEY]).toBeNull();
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r!.data).toBeNull();
  });
});

describe('writeLumirealm', () => {
  test('does not clobber sibling extension keys (risuai)', async () => {
    const api = makeMockSpindle();
    api._put({
      id: 'c-1',
      name: 'Risu',
      extensions: {
        risuai: { backgroundHTML: '<bg />', utilityBot: false },
      },
    });
    await writeLumirealm(api, 'c-1', makeData(), 'user-1');
    const stored = api._chars.get('c-1')!;
    expect(stored.extensions['risuai']).toEqual({
      backgroundHTML: '<bg />',
      utilityBot: false,
    });
    expect(stored.extensions[LUMIREALM_EXT_KEY]).toMatchObject({
      display_owner: true,
    });
  });

  test('overwrites a prior lumirealm blob (shallow-merge at top level only)', async () => {
    const api = makeMockSpindle();
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    const v1 = buildLumirealmData(makePayload(), '0.1.0', [], { foo: { imageIds: ['img-1'] } });
    await writeLumirealm(api, 'c-1', v1, 'user-1');
    const v2 = buildLumirealmData(makePayload(), '0.1.0', [], { bar: { imageIds: ['img-2'] } });
    await writeLumirealm(api, 'c-1', v2, 'user-1');
    const r = await readLumirealm(api, 'c-1', 'user-1');
    // v2 wholesale-replaces v1 — asset_index is { bar }, not { foo, bar }.
    expect(r!.data!.asset_index).toEqual({ bar: { imageIds: ['img-2'] } });
  });

  test('propagates Spindle errors so callers can surface to the user', async () => {
    const api: SpindleCharactersApi = {
      async get() { return null; },
      async update() { throw new Error('forced failure'); },
      async list() { return { data: [], total: 0 }; },
    };
    await expect(writeLumirealm(api, 'c-1', makeData(), 'user-1')).rejects.toThrow('forced failure');
  });
});

describe('updateLumirealm', () => {
  test('reads, mutates, writes — preserving fields the mutator did not touch', async () => {
    const api = makeMockSpindle();
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    const initial = buildLumirealmData(
      makePayload(),
      '0.1.0',
      [],
      { foo: { imageIds: ['img-1'] } },
    );
    await writeLumirealm(api, 'c-1', initial, 'user-1');
    // Merge in a new asset key without touching anything else.
    const result = await updateLumirealm(api, 'c-1', 'user-1', (cur) => ({
      ...cur,
      asset_index: { ...cur.asset_index, bar: { imageIds: ['img-2'] } },
    }));
    expect(result).not.toBeNull();
    expect(result!.asset_index).toEqual({
      foo: { imageIds: ['img-1'] },
      bar: { imageIds: ['img-2'] },
    });
    expect(result!.translator_version).toBe('test-1.2.3');
    // Verify it actually persisted.
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r!.data!.asset_index).toEqual({
      foo: { imageIds: ['img-1'] },
      bar: { imageIds: ['img-2'] },
    });
  });

  test('returns null and does not write when target is not a lumirealm character', async () => {
    const api = makeMockSpindle();
    api._put({ id: 'c-1', name: 'Plain', extensions: {} });
    let mutatorCalled = false;
    const result = await updateLumirealm(api, 'c-1', 'user-1', (cur) => {
      mutatorCalled = true;
      return cur;
    });
    expect(result).toBeNull();
    expect(mutatorCalled).toBe(false);
    expect(api._chars.get('c-1')!.extensions[LUMIREALM_EXT_KEY]).toBeUndefined();
  });
});

describe('clearLumirealm', () => {
  test('writes null at the lumirealm key (soft remove)', async () => {
    const api = makeMockSpindle();
    api._put({ id: 'c-1', name: 'Risu', extensions: {} });
    await writeLumirealm(api, 'c-1', makeData(), 'user-1');
    const ok = await clearLumirealm(api, 'c-1', 'user-1');
    expect(ok).toBe(true);
    expect(api._chars.get('c-1')!.extensions[LUMIREALM_EXT_KEY]).toBeNull();
  });

  test('preserves sibling extensions on soft remove', async () => {
    const api = makeMockSpindle();
    api._put({
      id: 'c-1',
      name: 'Risu',
      extensions: { risuai: { utilityBot: true } },
    });
    await writeLumirealm(api, 'c-1', makeData(), 'user-1');
    await clearLumirealm(api, 'c-1', 'user-1');
    expect(api._chars.get('c-1')!.extensions['risuai']).toEqual({ utilityBot: true });
  });

  test('returns false on Spindle error', async () => {
    const api: SpindleCharactersApi = {
      async get() { return null; },
      async update() { throw new Error('forced'); },
      async list() { return { data: [], total: 0 }; },
    };
    const ok = await clearLumirealm(api, 'c-1', 'user-1');
    expect(ok).toBe(false);
  });
});

describe('listLumirealmCharacters', () => {
  test('returns only characters with valid lumirealm blobs', async () => {
    const api = makeMockSpindle();
    api._put({ id: 'c-1', name: 'Plain', extensions: {} });
    api._put({ id: 'c-2', name: 'Risu A', extensions: {} });
    api._put({ id: 'c-3', name: 'Soft Removed', extensions: {} });
    api._put({ id: 'c-4', name: 'Risu B', extensions: {} });
    await writeLumirealm(api, 'c-2', makeData(), 'user-1');
    await writeLumirealm(api, 'c-3', makeData(), 'user-1');
    await clearLumirealm(api, 'c-3', 'user-1'); // Now has lumirealm: null
    await writeLumirealm(api, 'c-4', makeData(), 'user-1');
    const list = await listLumirealmCharacters(api, 'user-1');
    expect(list.map((e) => e.character.id).sort()).toEqual(['c-2', 'c-4']);
  });

  test('paginates when paginate: true and more than `limit` characters exist', async () => {
    const api = makeMockSpindle();
    for (let i = 0; i < 5; i++) {
      const id = `c-${i}`;
      api._put({ id, name: `Risu ${i}`, extensions: {} });
      await writeLumirealm(api, id, makeData(), 'user-1');
    }
    const single = await listLumirealmCharacters(api, 'user-1', { limit: 2 });
    expect(single.length).toBe(2);
    const all = await listLumirealmCharacters(api, 'user-1', { limit: 2, paginate: true });
    expect(all.length).toBe(5);
  });

  test('caps limit at 200 server-side cap', async () => {
    const api = makeMockSpindle();
    let lastLimit = -1;
    const wrapped: SpindleCharactersApi = {
      get: api.get.bind(api),
      update: api.update.bind(api),
      async list(opts) {
        lastLimit = opts?.limit ?? -1;
        return api.list(opts);
      },
    };
    await listLumirealmCharacters(wrapped, 'user-1', { limit: 9999 });
    expect(lastLimit).toBe(200);
  });
});

describe('mergeUserOverrides', () => {
  const empty: LumirealmUserOverrides = {};

  test('adds new keys from the patch', () => {
    const next = mergeUserOverrides(empty, { utility_bot_override: true });
    expect(next).toEqual({ utility_bot_override: true });
  });

  test('overwrites existing keys', () => {
    const base: LumirealmUserOverrides = { utility_bot_override: true };
    const next = mergeUserOverrides(base, { utility_bot_override: false });
    expect(next).toEqual({ utility_bot_override: false });
  });

  test('null in patch deletes the key (revert-to-default)', () => {
    const base: LumirealmUserOverrides = { utility_bot_override: true };
    const next = mergeUserOverrides(base, { utility_bot_override: null });
    expect('utility_bot_override' in next).toBe(false);
  });

  test('undefined in patch is a no-op (key preserved)', () => {
    const base: LumirealmUserOverrides = { utility_bot_override: true };
    const next = mergeUserOverrides(base, { utility_bot_override: undefined });
    expect(next).toEqual({ utility_bot_override: true });
  });

  test('preserves untouched keys (shallow merge)', () => {
    const base: LumirealmUserOverrides = {
      utility_bot_override: true,
      attached_module_ids: ['mod-a'],
    };
    const next = mergeUserOverrides(base, { low_level_access_granted: true });
    expect(next).toEqual({
      utility_bot_override: true,
      attached_module_ids: ['mod-a'],
      low_level_access_granted: true,
    });
  });

  test('replaces array fields wholesale (does not deep-merge)', () => {
    const base: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
    };
    const next = mergeUserOverrides(base, { attached_module_ids: ['mod-c'] });
    expect(next.attached_module_ids).toEqual(['mod-c']);
  });

  test('clearing attached_module_world_books via null fully removes the key', () => {
    const base: LumirealmUserOverrides = {
      attached_module_ids: [],
      attached_module_world_books: { 'mod-a': 'wb-a' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-1', 'rx-2'] },
    };
    const next = mergeUserOverrides(base, {
      attached_module_world_books: null,
      attached_module_regex_script_ids: null,
    });
    expect('attached_module_world_books' in next).toBe(false);
    expect('attached_module_regex_script_ids' in next).toBe(false);
    expect(next.attached_module_ids).toEqual([]);
  });
});

describe('buildAttachModulePatch', () => {
  test('empty overrides + module + no wb: ids has new id, wb null', () => {
    const patch = buildAttachModulePatch({}, 'mod-a', null);
    expect(patch.attached_module_ids).toEqual(['mod-a']);
    expect(patch.attached_module_world_books).toBeNull();
  });

  test('empty overrides + module + wb: ids and wb both set', () => {
    const patch = buildAttachModulePatch({}, 'mod-a', 'wb-a');
    expect(patch.attached_module_ids).toEqual(['mod-a']);
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
  });

  test('append to existing ids preserves order', () => {
    const cur: LumirealmUserOverrides = { attached_module_ids: ['mod-a', 'mod-b'] };
    const patch = buildAttachModulePatch(cur, 'mod-c', null);
    expect(patch.attached_module_ids).toEqual(['mod-a', 'mod-b', 'mod-c']);
  });

  test('attaches with wb merging into existing wb map', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
    };
    const patch = buildAttachModulePatch(cur, 'mod-b', 'wb-b');
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a', 'mod-b': 'wb-b' });
  });

  test('attach without wb does not pollute existing wb map', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
    };
    const patch = buildAttachModulePatch(cur, 'mod-b', null);
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
  });

  test('does not mutate the input overrides object', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
    };
    const idsBefore = cur.attached_module_ids;
    const wbBefore = cur.attached_module_world_books;
    buildAttachModulePatch(cur, 'mod-b', 'wb-b');
    expect(cur.attached_module_ids).toBe(idsBefore);
    expect(cur.attached_module_world_books).toBe(wbBefore);
    expect(cur.attached_module_ids).toEqual(['mod-a']);
    expect(cur.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
  });

  test('round-trip via mergeUserOverrides yields fully-formed user_overrides', () => {
    const cur: LumirealmUserOverrides = {};
    const patch = buildAttachModulePatch(cur, 'mod-a', 'wb-a');
    const next = mergeUserOverrides(cur, patch);
    expect(next.attached_module_ids).toEqual(['mod-a']);
    expect(next.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
  });
});

describe('buildDetachModulesPatch', () => {
  test('empty overrides + detach single: ids empty, all maps null', () => {
    const patch = buildDetachModulesPatch({}, ['mod-a']);
    expect(patch.attached_module_ids).toEqual([]);
    expect(patch.attached_module_world_books).toBeNull();
    expect(patch.attached_module_regex_script_ids).toBeNull();
  });

  test('detach the only attached module: maps collapse to null', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-1', 'rx-2'] },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-a']);
    expect(patch.attached_module_ids).toEqual([]);
    expect(patch.attached_module_world_books).toBeNull();
    expect(patch.attached_module_regex_script_ids).toBeNull();
  });

  test('detach one of two: other survives in all maps', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-b': 'wb-b' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a1'], 'mod-b': ['rx-b1', 'rx-b2'] },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-a']);
    expect(patch.attached_module_ids).toEqual(['mod-b']);
    expect(patch.attached_module_world_books).toEqual({ 'mod-b': 'wb-b' });
    expect(patch.attached_module_regex_script_ids).toEqual({ 'mod-b': ['rx-b1', 'rx-b2'] });
  });

  test('bulk detach all: ids empty, both maps null', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b', 'mod-c'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-c': 'wb-c' },
      attached_module_regex_script_ids: { 'mod-b': ['rx-b'] },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-a', 'mod-b', 'mod-c']);
    expect(patch.attached_module_ids).toEqual([]);
    expect(patch.attached_module_world_books).toBeNull();
    expect(patch.attached_module_regex_script_ids).toBeNull();
  });

  test('bulk detach mix of present and absent ids: absent are no-op', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
      attached_module_regex_script_ids: { 'mod-b': ['rx-b'] },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-a', 'mod-z-not-attached']);
    expect(patch.attached_module_ids).toEqual(['mod-b']);
    expect(patch.attached_module_world_books).toBeNull();
    expect(patch.attached_module_regex_script_ids).toEqual({ 'mod-b': ['rx-b'] });
  });

  test('detach orphan id present in wb but not in ids list: wb key still stripped', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-orphan': 'wb-orphan' },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-orphan']);
    expect(patch.attached_module_ids).toEqual(['mod-a']);
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
  });

  test('detach lopsided: id in ids but not in wb/rx maps', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-b']);
    expect(patch.attached_module_ids).toEqual(['mod-a']);
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
    expect(patch.attached_module_regex_script_ids).toBeNull();
  });

  test('does not mutate the input overrides object', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-b': 'wb-b' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a'], 'mod-b': ['rx-b'] },
    };
    buildDetachModulesPatch(cur, ['mod-a']);
    expect(cur.attached_module_ids).toEqual(['mod-a', 'mod-b']);
    expect(cur.attached_module_world_books).toEqual({ 'mod-a': 'wb-a', 'mod-b': 'wb-b' });
    expect(cur.attached_module_regex_script_ids).toEqual({ 'mod-a': ['rx-a'], 'mod-b': ['rx-b'] });
  });

  test('empty moduleIds list: filter is no-op, maps unchanged', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a'] },
    };
    const patch = buildDetachModulesPatch(cur, []);
    expect(patch.attached_module_ids).toEqual(['mod-a']);
    expect(patch.attached_module_world_books).toEqual({ 'mod-a': 'wb-a' });
    expect(patch.attached_module_regex_script_ids).toEqual({ 'mod-a': ['rx-a'] });
  });

  test('round-trip via mergeUserOverrides on full detach removes the keys', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a'],
      attached_module_world_books: { 'mod-a': 'wb-a' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a'] },
    };
    const patch = buildDetachModulesPatch(cur, ['mod-a']);
    const next = mergeUserOverrides(cur, patch);
    expect(next.attached_module_ids).toEqual([]);
    expect('attached_module_world_books' in next).toBe(false);
    expect('attached_module_regex_script_ids' in next).toBe(false);
  });

  test('parity: produces same shape as inline single-detach pattern (regression guard)', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-b': 'wb-b' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a'], 'mod-b': ['rx-b'] },
    };
    const moduleId = 'mod-a';
    const inlineWb = { ...(cur.attached_module_world_books ?? {}) };
    delete inlineWb[moduleId];
    const inlineRx = { ...(cur.attached_module_regex_script_ids ?? {}) };
    delete inlineRx[moduleId];
    const inlinePatch = {
      attached_module_ids: (cur.attached_module_ids ?? []).filter((id) => id !== moduleId),
      attached_module_world_books: Object.keys(inlineWb).length > 0 ? inlineWb : null,
      attached_module_regex_script_ids: Object.keys(inlineRx).length > 0 ? inlineRx : null,
    };
    const helperPatch = buildDetachModulesPatch(cur, [moduleId]);
    expect(helperPatch).toEqual(inlinePatch);
  });

  test('parity: produces same shape as inline bulk-detach pattern (scrubDanglingModuleRefs regression)', () => {
    const cur: LumirealmUserOverrides = {
      attached_module_ids: ['mod-a', 'mod-b', 'mod-c'],
      attached_module_world_books: { 'mod-a': 'wb-a', 'mod-c': 'wb-c' },
      attached_module_regex_script_ids: { 'mod-a': ['rx-a'], 'mod-b': ['rx-b'] },
    };
    const danglingIds = ['mod-a', 'mod-c'];
    const inlineWb = { ...(cur.attached_module_world_books ?? {}) };
    const inlineRx = { ...(cur.attached_module_regex_script_ids ?? {}) };
    for (const id of danglingIds) {
      delete inlineWb[id];
      delete inlineRx[id];
    }
    const inlinePatch = {
      attached_module_ids: (cur.attached_module_ids ?? []).filter((id) => !danglingIds.includes(id)),
      attached_module_world_books: Object.keys(inlineWb).length > 0 ? inlineWb : null,
      attached_module_regex_script_ids: Object.keys(inlineRx).length > 0 ? inlineRx : null,
    };
    const helperPatch = buildDetachModulesPatch(cur, danglingIds);
    expect(helperPatch).toEqual(inlinePatch);
  });
});

describe('buildSyntheticStoredCard', () => {
  test('reads bg-html / utility_bot / scriptstate_defaults from lumirealm.payload (primary source)', () => {
    // This is the regression scenario from 2026-04-27: lumirealm-
    // imported character has the data on payload.* but
    // extensions.risuai is empty. Without dual-read fallback, runtime
    // saw null bg-html → clear_bg_html fired → button clicks rejected.
    const data = buildLumirealmData(makePayload({
      background_html: '<div class="cog">cog button</div>',
      utility_bot: true,
      scriptstate_defaults: { jiyoon_current_icon: 'jiyoon_icon1.png' },
    }), '0.1.0');
    const card = buildSyntheticStoredCard('c-1', data, /* empty risuai */ {});
    expect(card.risuPayload.background_html).toBe('<div class="cog">cog button</div>');
    expect(card.risuPayload.utility_bot).toBe(true);
    expect(card.risuPayload.scriptstate_defaults).toEqual({
      jiyoon_current_icon: 'jiyoon_icon1.png',
    });
  });

  test('falls back to extensions[risuai].backgroundHTML when lumirealm.payload.background_html is null', () => {
    // Realistic case: lumirealm.payload was written by an old version
    // of the extension before the regression fix put background_html
    // back on the blob. Or: blob got partially corrupted. Runtime
    // should still find a usable bg-html via the risuai mirror so
    // the chat doesn't fall back to clear_bg_html.
    const emptyData = buildLumirealmData(makePayload({
      background_html: null,
      scriptstate_defaults: {},
    }), '0.1.0');
    const card = buildSyntheticStoredCard('c-1', emptyData, {
      backgroundHTML: '<div>from risuai</div>',
      defaultVariables: 'phase=A\naffection_total=0\n',
    });
    expect(card.risuPayload.background_html).toBe('<div>from risuai</div>');
    // scriptstate_defaults: empty lumirealm → parse risuai.defaultVariables.
    expect(card.risuPayload.scriptstate_defaults).toEqual({
      phase: 'A',
      affection_total: '0',
    });
  });

  test('falls back to extensions[risuai].utilityBot when lumirealm.payload.utility_bot is missing (old-schema blob)', () => {
    // Pre-fix lumirealm blobs literally lacked the utility_bot key.
    // TypeScript says the field is required, but runtime sees
    // undefined for old data. Cast through unknown to construct that
    // shape and verify the dual-read kicks in.
    const oldSchemaBlob = {
      ...buildLumirealmData(makePayload(), '0.1.0'),
      payload: (() => {
        const p = { ...buildLumirealmData(makePayload(), '0.1.0').payload } as Record<string, unknown>;
        delete p.utility_bot;
        delete p.background_html;
        delete p.scriptstate_defaults;
        return p;
      })(),
    } as unknown as LumirealmCharacterData;
    const card = buildSyntheticStoredCard('c-1', oldSchemaBlob, {
      utilityBot: true,
    });
    expect(card.risuPayload.utility_bot).toBe(true);
  });

  test('lumirealm.payload wins over risuai on conflict', () => {
    // If both are populated (e.g. native CharX import where the
    // user later wrote lumirealm via reimport), lumirealm.payload
    // is the authoritative source — our writes are deterministic;
    // risuai is just a fallback mirror.
    const data = buildLumirealmData(makePayload({
      background_html: '<div>lumirealm wins</div>',
      utility_bot: true,
      scriptstate_defaults: { phase: 'A' },
    }), '0.1.0');
    const card = buildSyntheticStoredCard('c-1', data, {
      backgroundHTML: '<div>risuai loses</div>',
      utilityBot: false,
      defaultVariables: 'phase=Z\n',
    });
    expect(card.risuPayload.background_html).toBe('<div>lumirealm wins</div>');
    expect(card.risuPayload.utility_bot).toBe(true);
    expect(card.risuPayload.scriptstate_defaults).toEqual({ phase: 'A' });
  });

  test('user_overrides.utility_bot_override wins over both card layers', () => {
    const data: LumirealmCharacterData = {
      ...buildLumirealmData(makePayload({ utility_bot: false }), '0.1.0'),
      user_overrides: { utility_bot_override: true },
    };
    const card = buildSyntheticStoredCard('c-1', data, { utilityBot: false });
    expect(card.risuPayload.utility_bot).toBe(true);
  });

  test('user_overrides.default_variables_overrides merge on top of card defaults', () => {
    const data: LumirealmCharacterData = {
      ...buildLumirealmData(makePayload({
        scriptstate_defaults: { phase: 'A', mood: 'neutral' },
      }), '0.1.0'),
      user_overrides: {
        default_variables_overrides: { phase: 'C', custom_key: 'user-set' },
      },
    };
    const card = buildSyntheticStoredCard('c-1', data, {});
    expect(card.risuPayload.scriptstate_defaults).toEqual({
      phase: 'C',                  // override wins
      mood: 'neutral',             // untouched
      custom_key: 'user-set',      // added
    });
  });

  test('regression smoke: a freshly-built lumirealm blob with bg-html must NOT produce a null bg in the synthesized card', () => {
    // The 2026-04-27 user-reported bug compressed: import → readLumirealm
    // → buildSyntheticStoredCard → card.risuPayload.background_html
    // must be the actual bg, not null. If this test ever turns null
    // again, refreshBgHtml will fire clear_bg_html → activeRisuChatId
    // nulls → button clicks die. Pin the contract.
    const realisticPayload = makePayload({
      background_html: '<style>.cog{position:fixed}</style><div risu-trigger="setLangToEnglish">EN</div>',
      utility_bot: false,
      scriptstate_defaults: {},
    });
    const data = buildLumirealmData(realisticPayload, '0.1.0');
    const card = buildSyntheticStoredCard('c-1', data, /* empty risuai */ {});
    expect(card.risuPayload.background_html).not.toBeNull();
    expect(card.risuPayload.background_html?.length ?? 0).toBeGreaterThan(0);
  });
});
