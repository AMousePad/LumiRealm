/**
 * Probe tests for the lumirealm-character helpers — covers behaviors I
 * COULDN'T predict from the spec.
 *
 * The behavior-I-knew tests live in `state-lumirealm-character.test.ts`:
 * happy-path round-trip, soft-remove sentinel, list pagination, etc.
 * These are different — they're DELIBERATELY HOSTILE. The hypothesis
 * for each test is "if X happened, what would the helpers do?" with X
 * being a thing the spec never promised either way:
 *
 *   - Lumi shape drift (extension key collision with reserved names,
 *     extensions field returned as null instead of empty object,
 *     CharacterDTO missing extensions entirely)
 *   - Mid-flight character mutation (character row deleted between
 *     read and write of an updateLumirealm RMW; another extension's
 *     update interleaves)
 *   - Adversarial inputs (NaN ids, extremely long names, prototype-
 *     polluted extensions blob, deeply nested user_overrides patches)
 *   - Concurrent reads + ordering assumptions
 *   - The CHARACTER_DELETED FK-cascade interaction surfaced by Lumi
 *     bug 2026-04-27: chats.character_id ON DELETE CASCADE means a
 *     hard character delete drops chats too. The lumirealm soft-remove
 *     path keeps the character row + sets lumirealm:null, which leaves
 *     chats intact pointing at the (now non-lumirealm) character. Verify
 *     soft-remove doesn't break sibling-key reads either.
 *
 * The expectations here are PROVISIONAL. Some pin behaviors that may
 * be wrong (or right but need a docs note). Failing tests in this file
 * should trigger investigation, not silent fix.
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
  type CharacterDTOLike,
  type SpindleCharactersApi,
} from '../../src/state/lumirealm-character.js';
import {
  buildLumirealmData,
  isLumirealmData,
} from '../../src/payload/codec.js';
import {
  LUMIREALM_EXT_KEY,
  type LumirealmCharacterData,
  type RisuPayload,
} from '../../src/payload/types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────

interface MockChar {
  id: string;
  name: string;
  extensions: Record<string, unknown>;
  __deletedMidFlight?: boolean;
}

function makeMockSpindle() {
  const chars = new Map<string, MockChar>();
  let getCallCount = 0;
  let updateCallCount = 0;
  const api: SpindleCharactersApi = {
    async get(id) {
      getCallCount += 1;
      const c = chars.get(id);
      if (!c || c.__deletedMidFlight) return null;
      return {
        id: c.id,
        name: c.name,
        extensions: { ...c.extensions },
      } as CharacterDTOLike;
    },
    async update(id, input) {
      updateCallCount += 1;
      const existing = chars.get(id);
      if (!existing || existing.__deletedMidFlight) {
        throw new Error('Character not found');
      }
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
    async list(opts) {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;
      const all = [...chars.values()].filter((c) => !c.__deletedMidFlight);
      return {
        data: all.slice(offset, offset + limit).map((c) => ({
          id: c.id,
          name: c.name,
          extensions: { ...c.extensions },
        })) as CharacterDTOLike[],
        total: all.length,
      };
    },
  };
  return {
    api,
    chars,
    callCounts: () => ({ get: getCallCount, update: updateCallCount }),
    seed(c: MockChar) { chars.set(c.id, c); },
    deleteMidFlight(id: string) {
      const c = chars.get(id);
      if (c) c.__deletedMidFlight = true;
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
    translator_version: 'probe',
    risu_spec_version: 'risu-test',
    requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    ...overrides,
  };
}

const baseData = (): LumirealmCharacterData =>
  buildLumirealmData(makePayload(), '0.1.0');

// ─── Lumi shape drift probes ─────────────────────────────────────────────

describe('PROBE: Lumi DTO shape drift', () => {
  test('character DTO with extensions === null (not an object) does not crash readLumirealm', async () => {
    // Nothing in the docs guarantees `extensions` is always an object;
    // a future Lumi build could short-circuit empty maps to null. Our
    // narrowing must tolerate that.
    const api: SpindleCharactersApi = {
      async get() {
        return { id: 'c-1', name: 'X', extensions: null as unknown as Record<string, unknown> };
      },
      async update() { throw new Error('not used'); },
      async list() { return { data: [], total: 0 }; },
    };
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r).not.toBeNull();
    expect(r!.data).toBeNull();
    expect(r!.risuai).toEqual({});
  });

  test('character DTO missing extensions field entirely does not crash readLumirealm', async () => {
    const api: SpindleCharactersApi = {
      async get() {
        return { id: 'c-1', name: 'X' } as CharacterDTOLike;
      },
      async update() { throw new Error('not used'); },
      async list() { return { data: [], total: 0 }; },
    };
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r).not.toBeNull();
    expect(r!.data).toBeNull();
    expect(r!.risuai).toEqual({});
  });

  test('extensions.lumirealm with valid schema_version but corrupted payload subtree does NOT throw at narrowing — caller should defensively read', async () => {
    // isLumirealmData is intentionally shallow (schema_version === 1
    // only; deep validation would be expensive on every chat-open).
    // A corrupt blob (e.g. payload === null) passes the narrowing
    // gate but would throw on first access. Document the behavior.
    const fixture = {
      schema_version: 1,
      // payload missing entirely
    } as unknown as LumirealmCharacterData;
    expect(isLumirealmData(fixture)).toBe(true);
    // Caller-side: accessing fixture.payload.triggers would throw at runtime.
    // This is acceptable because: (a) we own all writes, so corrupt blobs
    // come from manual DB edits or other extensions colliding on our key,
    // (b) the next ensureActiveCardForChat would surface the throw via
    // toast.error, and (c) `extensions: { lumirealm: null }` (the
    // soft-remove sentinel) returns false from isLumirealmData and is
    // handled cleanly.
    expect(() => (fixture.payload!).triggers).toThrow();
  });

  test('extensions array (illegal — Lumi requires object) is rejected', async () => {
    // worker-host.ts:4430-4432 throws on `Array.isArray(input.extensions)`,
    // so this state can't arrive via Spindle. But REST PUT could
    // theoretically (Lumi DOES validate? let's not assume). Probe:
    const api: SpindleCharactersApi = {
      async get() {
        return {
          id: 'c-1',
          name: 'X',
          extensions: ['lumirealm-ish'] as unknown as Record<string, unknown>,
        };
      },
      async update() { throw new Error('not used'); },
      async list() { return { data: [], total: 0 }; },
    };
    const r = await readLumirealm(api, 'c-1', 'user-1');
    expect(r!.data).toBeNull();
    expect(r!.risuai).toEqual({});
  });
});

// ─── Mid-flight mutation probes ─────────────────────────────────────────

describe('PROBE: mid-flight mutation', () => {
  test('updateLumirealm RMW: character deleted between read and write surfaces the underlying error', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: { [LUMIREALM_EXT_KEY]: baseData() } });
    let mutatorRan = false;
    await expect(
      updateLumirealm(m.api, 'c-1', 'user-1', (cur) => {
        mutatorRan = true;
        // Simulate concurrent delete between the read and the write.
        m.deleteMidFlight('c-1');
        return cur;
      }),
    ).rejects.toThrow('Character not found');
    expect(mutatorRan).toBe(true);
  });

  test('updateLumirealm against soft-removed character treats null as absent and skips the mutator', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: { [LUMIREALM_EXT_KEY]: null } });
    let mutatorRan = false;
    const result = await updateLumirealm(m.api, 'c-1', 'user-1', (cur) => {
      mutatorRan = true;
      return cur;
    });
    expect(result).toBeNull();
    expect(mutatorRan).toBe(false);
    // Soft-remove sentinel still in place after the no-op.
    expect(m.chars.get('c-1')!.extensions[LUMIREALM_EXT_KEY]).toBeNull();
  });

  test('writeLumirealm against character deleted mid-flight throws the underlying error (caller surfaces toast)', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: {} });
    m.deleteMidFlight('c-1');
    await expect(writeLumirealm(m.api, 'c-1', baseData(), 'user-1')).rejects.toThrow('Character not found');
  });
});

// ─── Adversarial input probes ───────────────────────────────────────────

describe('PROBE: adversarial inputs', () => {
  test('characterId with newline / null byte / unicode bidi marker does not crash', async () => {
    const m = makeMockSpindle();
    const adversarialIds = [
      'c\nid',                         // newline
      'c\x00id',                       // null byte (mongoDB-style smuggle)
      'c‮id',                     // RTL override (bidi)
      'c'.repeat(10_000),              // very long
      '../../etc/passwd',              // path-traversal flavor
    ];
    for (const id of adversarialIds) {
      const r = await readLumirealm(m.api, id, 'user-1');
      // We don't sanitize; we just pass through. Spindle's get returns
      // null for unknown ids, so result should be null. The harness
      // mock matches that.
      expect(r).toBeNull();
    }
  });

  test('extensions.lumirealm with prototype pollution payload does not pollute Object.prototype', async () => {
    const m = makeMockSpindle();
    const polluted = {
      schema_version: 1,
      __proto__: { polluted: true },
    } as unknown as LumirealmCharacterData;
    m.seed({ id: 'c-1', name: 'X', extensions: { [LUMIREALM_EXT_KEY]: polluted } });
    const r = await readLumirealm(m.api, 'c-1', 'user-1');
    expect(r!.data).not.toBeNull();
    // Walk the prototype chain — we should NOT see "polluted" on
    // Object.prototype as a side effect.
    expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    const literal: Record<string, unknown> = {};
    expect((literal as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test('mergeUserOverrides with __proto__ key in patch does NOT walk into the prototype', () => {
    const base = { utility_bot_override: true } as const;
    // Patch object includes __proto__ as a regular key — JSON.parse would
    // produce this if input came over the wire.
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    // mergeUserOverrides iterates Object.keys, which doesn't include
    // __proto__ on a literal — so this is a no-op merge by design.
    const next = mergeUserOverrides(base, polluted);
    // utility_bot_override preserved (the patch had no real keys).
    expect(next).toEqual({ utility_bot_override: true });
    expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test('lumirealm blob with extremely deep user_overrides does not OOM at JSON.stringify', async () => {
    // Synthesize a 4-deep override that's wider than typical to make
    // sure stringify cost is bounded. Lumi will JSON.stringify the
    // extensions field for SQLite TEXT storage.
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: {} });
    const wideOverrides: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      wideOverrides[`key_${i}`] = 'v'.repeat(100);
    }
    const data = buildLumirealmData(makePayload(), '0.1.0');
    const withOverrides: LumirealmCharacterData = {
      ...data,
      user_overrides: {
        default_variables_overrides: wideOverrides,
      },
    };
    await writeLumirealm(m.api, 'c-1', withOverrides, 'user-1');
    const r = await readLumirealm(m.api, 'c-1', 'user-1');
    expect(Object.keys(r!.data!.user_overrides.default_variables_overrides!).length).toBe(1000);
  });
});

// ─── Concurrent / ordering probes ───────────────────────────────────────

describe('PROBE: concurrent + ordering', () => {
  test('readLumirealm called in parallel against same id makes N independent get calls (no de-dup at our layer)', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: { [LUMIREALM_EXT_KEY]: baseData() } });
    const before = m.callCounts().get;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => readLumirealm(m.api, 'c-1', 'user-1')),
    );
    const after = m.callCounts().get;
    expect(results.every((r) => r?.data?.schema_version === 1)).toBe(true);
    expect(after - before).toBe(5);
    // If we ever add de-dup caching, this expectation flips → revisit.
  });

  test('listLumirealmCharacters returns characters in Spindle-list order, NOT imported_at order', async () => {
    // List ordering is the caller's concern (backend.ts listCards
    // sorts by imported_at desc). The helper preserves Spindle's
    // ordering — usually created_at desc. Pin so a future "reverse
    // for ergonomics" change doesn't silently break listCards.
    const m = makeMockSpindle();
    for (const [i, name] of ['Alpha', 'Bravo', 'Charlie'].entries()) {
      const data = buildLumirealmData(makePayload(), '0.1.0', [], {}, {}, 100 + i);
      m.seed({ id: `c-${i}`, name, extensions: { [LUMIREALM_EXT_KEY]: data } });
    }
    const list = await listLumirealmCharacters(m.api, 'user-1');
    expect(list.map((e) => e.character.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  test('clearLumirealm + readLumirealm same character — no race, null sentinel observable on next read', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: { [LUMIREALM_EXT_KEY]: baseData() } });
    // Sanity: present.
    expect((await readLumirealm(m.api, 'c-1', 'user-1'))!.data).not.toBeNull();
    await clearLumirealm(m.api, 'c-1', 'user-1');
    // After: sentinel observable.
    const after = await readLumirealm(m.api, 'c-1', 'user-1');
    expect(after!.data).toBeNull();
    expect(m.chars.get('c-1')!.extensions[LUMIREALM_EXT_KEY]).toBeNull();
  });
});

// ─── FK cascade interaction probes (Lumi DB-shape coupling) ─────────────

describe('PROBE: Lumi DB FK cascade interactions', () => {
  test('soft-remove preserves the character row — sibling extensions survive (risuai readable)', async () => {
    // This is the contract that distinguishes soft-remove (clearLumirealm
    // sets lumirealm:null) from hard-delete (Lumi cascades the row
    // including chats.character_id FK → chats are gone). Soft-remove
    // MUST leave the character row intact so any non-lumirealm extensions
    // that wrote namespaced data to extensions.foo keep their state.
    const m = makeMockSpindle();
    m.seed({
      id: 'c-1',
      name: 'X',
      extensions: {
        [LUMIREALM_EXT_KEY]: baseData(),
        risuai: { backgroundHTML: '<bg />', utilityBot: true },
        'com.example.quest-mod': { stage: 3, affinity: 72 },
      },
    });
    await clearLumirealm(m.api, 'c-1', 'user-1');
    const stored = m.chars.get('c-1')!;
    expect(stored.extensions[LUMIREALM_EXT_KEY]).toBeNull();
    expect(stored.extensions['risuai']).toEqual({ backgroundHTML: '<bg />', utilityBot: true });
    expect(stored.extensions['com.example.quest-mod']).toEqual({ stage: 3, affinity: 72 });
  });

  test('writing a fresh lumirealm blob does not mutate sibling extension keys', async () => {
    const m = makeMockSpindle();
    m.seed({
      id: 'c-1',
      name: 'X',
      extensions: {
        risuai: { utilityBot: true, customField: { nested: 'value' } },
      },
    });
    await writeLumirealm(m.api, 'c-1', baseData(), 'user-1');
    const stored = m.chars.get('c-1')!;
    // risuai still there + structure preserved (NOT shallow-merged into
    // by our write — we only touched lumirealm key)
    expect(stored.extensions['risuai']).toEqual({
      utilityBot: true,
      customField: { nested: 'value' },
    });
    expect(stored.extensions[LUMIREALM_EXT_KEY]).toBeDefined();
  });

  test('writeLumirealm sequence: write → soft-remove → write again restores fresh state (no orphaned partial)', async () => {
    const m = makeMockSpindle();
    m.seed({ id: 'c-1', name: 'X', extensions: {} });
    const v1 = buildLumirealmData(makePayload(), '0.1.0', [], { foo: { imageIds: ['img-1'] } });
    await writeLumirealm(m.api, 'c-1', v1, 'user-1');
    await clearLumirealm(m.api, 'c-1', 'user-1');
    const v2 = buildLumirealmData(makePayload(), '0.1.0', [], { bar: { imageIds: ['img-2'] } });
    await writeLumirealm(m.api, 'c-1', v2, 'user-1');
    const r = await readLumirealm(m.api, 'c-1', 'user-1');
    // After re-write, blob is exactly v2 — no v1 leakage from before-soft-remove.
    expect(r!.data!.asset_index).toEqual({ bar: { imageIds: ['img-2'] } });
  });
});

// ─── Inputs that should NOT be valid lumirealm blobs ────────────────────

describe('PROBE: isLumirealmData rejects non-blob shapes', () => {
  // Reinforce isLumirealmData edge cases not covered in the happy-path tests.
  const NOT_VALID = [
    null,
    undefined,
    0,
    -1,
    1,
    NaN,
    Infinity,
    '',
    'lumirealm',
    [],
    [{ schema_version: 1 }],
    () => ({}),
    Symbol('lumirealm'),
    new Map(),
    new Set([{ schema_version: 1 }]),
    Promise.resolve({ schema_version: 1 }),
    { schema_version: '1' },         // string, not number
    { schema_version: true },        // boolean
    { schema_version: null },
    { schema_version: undefined },
    { schema_version: 0 },
    { schema_version: 2 },
    { /* empty */ },
  ];

  for (const fixture of NOT_VALID) {
    test(`rejects ${typeof fixture === 'object' ? JSON.stringify(fixture, (_, v) => typeof v === 'function' ? '<fn>' : v)?.slice(0, 60) : String(fixture)}`, () => {
      expect(isLumirealmData(fixture)).toBe(false);
    });
  }
});
