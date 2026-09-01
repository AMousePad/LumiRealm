/**
 * Pin behaviour of the user-global risum module library persistence
 * layer. Covers pure helpers (`summarizeEnvelope`, `upsertIndex`,
 * `removeFromIndex`) AND the storage round-trip against an in-memory
 * UserStorageLike fake.
 */

import { describe, test, expect } from 'bun:test';
import {
  MODULE_SCHEMA_VERSION,
  type ModuleEnvelope,
  type ModuleIndex,
  type ModuleIndexEntry,
  type UserStorageLike,
  deleteModule,
  envelopePath,
  listModules,
  pairModuleAssetsForUpload,
  readEnvelope,
  readIndex,
  rebuildIndex,
  removeFromIndex,
  summarizeEnvelope,
  upsertIndex,
  writeEnvelope,
  writeIndex,
} from '../../src/state/modules-store.js';
import type { RisuModule } from '../../src/core/schemas/module.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

function moduleFixture(overrides: Partial<RisuModule> = {}): RisuModule {
  return {
    id: 'mod-A',
    name: 'Touhou Lightboard',
    description: 'Reimu broadcaster',
    lorebook: [],
    regex: [],
    trigger: [],
    ...overrides,
  } as RisuModule;
}

function envelopeFixture(overrides: Partial<ModuleEnvelope> = {}): ModuleEnvelope {
  return {
    schema_version: MODULE_SCHEMA_VERSION,
    id: 'mod-A',
    filename: 'Touhou Lightboard.risum',
    uploaded_at: 1700000000000,
    module: moduleFixture(),
    asset_index: {},
    ...overrides,
  };
}

// ─── In-memory UserStorageLike fake ───────────────────────────────────
//
// The real spindle.userStorage is operator-scoped (userId argument
// matters). Our fake honours the userId by partitioning paths into a
// per-user map so test cases can verify the helpers thread userId
// correctly. Pass `undefined` for the unscoped fallback bucket.

function createFakeStorage(): UserStorageLike & {
  inspect(): Record<string, Record<string, Uint8Array>>;
} {
  const buckets = new Map<string, Map<string, Uint8Array>>();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const bucketFor = (userId: string | undefined): Map<string, Uint8Array> => {
    const key = userId ?? '__no_user__';
    let b = buckets.get(key);
    if (!b) {
      b = new Map();
      buckets.set(key, b);
    }
    return b;
  };

  return {
    async read(path, userId) {
      return bucketFor(userId).get(path) ?? null;
    },
    async write(path, data, userId) {
      bucketFor(userId).set(path, data);
    },
    async delete(path, userId) {
      bucketFor(userId).delete(path);
    },
    async list(prefix, userId) {
      const out: string[] = [];
      const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
      for (const key of bucketFor(userId).keys()) {
        if (key.startsWith(normalized)) {
          // Lumi's list returns prefix-relative paths, not full paths.
          out.push(key.slice(normalized.length));
        }
      }
      return out;
    },
    async exists(path, userId) {
      return bucketFor(userId).has(path);
    },
    async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
      const data = bucketFor(options?.userId).get(path);
      if (!data) {
        if (options && 'fallback' in options) return options.fallback as T;
        throw new Error(`getJson: missing ${path}`);
      }
      return JSON.parse(dec.decode(data)) as T;
    },
    async setJson(path, value, options) {
      const text = JSON.stringify(value, null, options?.indent);
      bucketFor(options?.userId).set(path, enc.encode(text));
    },
    inspect() {
      const out: Record<string, Record<string, Uint8Array>> = {};
      for (const [user, bucket] of buckets) {
        out[user] = Object.fromEntries(bucket);
      }
      return out;
    },
  };
}

// ─── Pure helper tests ─────────────────────────────────────────────────

describe('summarizeEnvelope', () => {
  test('captures collection counts from a module body', () => {
    const env = envelopeFixture({
      module: moduleFixture({
        lorebook: [
          { key: 'a', content: 'A' } as never,
          { key: 'b', content: 'B' } as never,
        ],
        regex: [
          { in: '/x/', out: 'y', type: 'editdisplay' } as never,
        ],
        trigger: [
          { type: 'manual', comment: 'btn', conditions: [], effect: [] } as never,
          { type: 'manual', comment: 'btn2', conditions: [], effect: [] } as never,
          { type: 'manual', comment: 'btn3', conditions: [], effect: [] } as never,
        ],
      }),
      asset_index: {
        'reimu.png': { imageId: 'img-1' },
        'marisa.png': { imageId: 'img-2' },
      },
    });
    const s = summarizeEnvelope(env);
    expect(s.lorebook_count).toBe(2);
    expect(s.regex_count).toBe(1);
    expect(s.trigger_count).toBe(3);
    expect(s.asset_count).toBe(2);
  });

  test('flags low-level access', () => {
    const env = envelopeFixture({
      module: moduleFixture({ lowLevelAccess: true }),
    });
    expect(summarizeEnvelope(env).low_level_access).toBe(true);
  });

  test('does NOT flag low-level access when absent or false', () => {
    expect(summarizeEnvelope(envelopeFixture()).low_level_access).toBe(false);
    expect(
      summarizeEnvelope(
        envelopeFixture({ module: moduleFixture({ lowLevelAccess: false }) }),
      ).low_level_access,
    ).toBe(false);
  });

  test('flags has_cjs when the module ships CommonJS', () => {
    const withCjs = summarizeEnvelope(
      envelopeFixture({ module: moduleFixture({ cjs: 'module.exports = {}' }) }),
    );
    const withoutCjs = summarizeEnvelope(envelopeFixture());
    expect(withCjs.has_cjs).toBe(true);
    expect(withoutCjs.has_cjs).toBe(false);
  });

  test('falls back to (unnamed) on missing/non-string name', () => {
    const env = envelopeFixture({
      module: { id: 'mod-X', name: '', description: '' } as never,
    });
    expect(summarizeEnvelope(env).name).toBe('');
    const env2 = envelopeFixture({
      module: { id: 'mod-X', description: '' } as unknown as RisuModule,
    });
    expect(summarizeEnvelope(env2).name).toBe('(unnamed)');
  });

  test('surfaces translatedName/Description per language from envelope.translations', () => {
    const env = envelopeFixture({
      module: moduleFixture({ name: '엔트리', description: '설명' }),
      translations: {
        en: { name: 'Entry', description: 'Description' },
      },
    } as never);
    const s = summarizeEnvelope(env);
    expect(s.translatedName?.en).toBe('Entry');
    expect(s.translatedDescription?.en).toBe('Description');
  });

  test('omits translatedName/Description when no translations present', () => {
    const env = envelopeFixture({ module: moduleFixture({ name: '엔트리' }) });
    const s = summarizeEnvelope(env);
    expect(s.translatedName).toBeUndefined();
    expect(s.translatedDescription).toBeUndefined();
  });

  test('skips empty-string entries in translation map', () => {
    const env = envelopeFixture({
      module: moduleFixture({ name: '엔트리', description: '설명' }),
      translations: {
        en: { name: '', description: 'Description' },
      },
    } as never);
    const s = summarizeEnvelope(env);
    expect(s.translatedName).toBeUndefined();
    expect(s.translatedDescription?.en).toBe('Description');
  });
});

describe('upsertIndex', () => {
  const baseEntry: ModuleIndexEntry = {
    id: 'mod-A',
    filename: 'a.risum',
    name: 'A',
    description: '',
    uploaded_at: 100,
    lorebook_count: 0,
    regex_count: 0,
    trigger_count: 0,
    asset_count: 0,
    low_level_access: false,
    has_cjs: false,
  };

  test('adds new entry to empty index', () => {
    const next = upsertIndex({ schema_version: MODULE_SCHEMA_VERSION, entries: [] }, baseEntry);
    expect(next.entries).toEqual([baseEntry]);
  });

  test('replaces existing entry by id (no duplication)', () => {
    const idx: ModuleIndex = {
      schema_version: MODULE_SCHEMA_VERSION,
      entries: [baseEntry],
    };
    const updated = { ...baseEntry, name: 'Renamed' };
    const next = upsertIndex(idx, updated);
    expect(next.entries.length).toBe(1);
    expect(next.entries[0]!.name).toBe('Renamed');
  });

  test('sorts most-recent uploaded_at first', () => {
    const old = { ...baseEntry, id: 'old', uploaded_at: 100 };
    const fresh = { ...baseEntry, id: 'fresh', uploaded_at: 200 };
    const idx: ModuleIndex = {
      schema_version: MODULE_SCHEMA_VERSION,
      entries: [old],
    };
    const next = upsertIndex(idx, fresh);
    expect(next.entries.map((e) => e.id)).toEqual(['fresh', 'old']);
  });

  test('does not mutate the input index', () => {
    const idx: ModuleIndex = {
      schema_version: MODULE_SCHEMA_VERSION,
      entries: [baseEntry],
    };
    const before = JSON.stringify(idx);
    upsertIndex(idx, { ...baseEntry, id: 'mod-B' });
    expect(JSON.stringify(idx)).toBe(before);
  });
});

describe('removeFromIndex', () => {
  const e: ModuleIndexEntry = {
    id: 'mod-X',
    filename: 'x.risum',
    name: 'X',
    description: '',
    uploaded_at: 1,
    lorebook_count: 0,
    regex_count: 0,
    trigger_count: 0,
    asset_count: 0,
    low_level_access: false,
    has_cjs: false,
  };

  test('removes the matching id', () => {
    const idx = { schema_version: MODULE_SCHEMA_VERSION as 1, entries: [e] };
    const next = removeFromIndex(idx, 'mod-X');
    expect(next.entries.length).toBe(0);
  });

  test('returns the SAME index reference when no match (cheap idempotent)', () => {
    const idx = { schema_version: MODULE_SCHEMA_VERSION as 1, entries: [e] };
    const next = removeFromIndex(idx, 'nope');
    expect(next).toBe(idx);
  });

  test('handles empty index', () => {
    const idx = { schema_version: MODULE_SCHEMA_VERSION as 1, entries: [] };
    const next = removeFromIndex(idx, 'whatever');
    expect(next).toBe(idx);
  });
});

// ─── Storage round-trip ────────────────────────────────────────────────

describe('writeEnvelope + readEnvelope round-trip', () => {
  test('writes envelope JSON + upserts index entry', async () => {
    const storage = createFakeStorage();
    const env = envelopeFixture();
    const entry = await writeEnvelope(storage, 'user-1', env);
    expect(entry.id).toBe('mod-A');
    expect(entry.name).toBe('Touhou Lightboard');

    const back = await readEnvelope(storage, 'user-1', 'mod-A');
    expect(back).not.toBeNull();
    expect(back!.id).toBe('mod-A');
    expect(back!.module.name).toBe('Touhou Lightboard');

    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0]!.id).toBe('mod-A');
  });

  test('per-user partitioning — user-1 envelope invisible to user-2', async () => {
    const storage = createFakeStorage();
    await writeEnvelope(storage, 'user-1', envelopeFixture());
    const u2 = await readEnvelope(storage, 'user-2', 'mod-A');
    expect(u2).toBeNull();
    const idxU2 = await readIndex(storage, 'user-2');
    expect(idxU2.entries.length).toBe(0);
  });

  test('returns null for non-existent module', async () => {
    const storage = createFakeStorage();
    const back = await readEnvelope(storage, 'user-1', 'nope');
    expect(back).toBeNull();
  });

  test('returns null for envelope with mismatched schema_version', async () => {
    const storage = createFakeStorage();
    // Manually inject a corrupt envelope.
    await storage.setJson(
      envelopePath('mod-bad'),
      { schema_version: 999, id: 'mod-bad' },
      { userId: 'user-1' },
    );
    const back = await readEnvelope(storage, 'user-1', 'mod-bad');
    expect(back).toBeNull();
  });

  test('re-writing same id replaces the envelope (idempotent re-upload)', async () => {
    const storage = createFakeStorage();
    await writeEnvelope(storage, 'user-1', envelopeFixture({ uploaded_at: 1 }));
    await writeEnvelope(storage, 'user-1', envelopeFixture({
      uploaded_at: 2,
      module: moduleFixture({ name: 'Renamed' }),
    }));
    const back = await readEnvelope(storage, 'user-1', 'mod-A');
    expect(back!.uploaded_at).toBe(2);
    expect(back!.module.name).toBe('Renamed');
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0]!.name).toBe('Renamed');
  });
});

describe('deleteModule', () => {
  test('removes envelope + index entry', async () => {
    const storage = createFakeStorage();
    await writeEnvelope(storage, 'user-1', envelopeFixture());
    expect(await readEnvelope(storage, 'user-1', 'mod-A')).not.toBeNull();
    await deleteModule(storage, 'user-1', 'mod-A');
    expect(await readEnvelope(storage, 'user-1', 'mod-A')).toBeNull();
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries.length).toBe(0);
  });

  test('idempotent on nonexistent id (no throw)', async () => {
    const storage = createFakeStorage();
    await deleteModule(storage, 'user-1', 'nope');
    // succeeds without throwing
  });

  test('does not affect other modules', async () => {
    const storage = createFakeStorage();
    await writeEnvelope(storage, 'user-1', envelopeFixture({ id: 'A', module: moduleFixture({ id: 'A', name: 'A' }) }));
    await writeEnvelope(storage, 'user-1', envelopeFixture({ id: 'B', module: moduleFixture({ id: 'B', name: 'B' }) }));
    await deleteModule(storage, 'user-1', 'A');
    expect(await readEnvelope(storage, 'user-1', 'A')).toBeNull();
    expect(await readEnvelope(storage, 'user-1', 'B')).not.toBeNull();
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries.map((e) => e.id)).toEqual(['B']);
  });
});

describe('listModules', () => {
  test('returns entries from the index, sorted most-recent first', async () => {
    const storage = createFakeStorage();
    await writeEnvelope(storage, 'user-1', envelopeFixture({
      id: 'old', uploaded_at: 100, module: moduleFixture({ id: 'old', name: 'Old' }),
    }));
    await writeEnvelope(storage, 'user-1', envelopeFixture({
      id: 'new', uploaded_at: 200, module: moduleFixture({ id: 'new', name: 'New' }),
    }));
    const list = await listModules(storage, 'user-1');
    expect(list.map((e) => e.id)).toEqual(['new', 'old']);
  });

  test('returns empty when no modules uploaded', async () => {
    const storage = createFakeStorage();
    const list = await listModules(storage, 'user-1');
    expect(list).toEqual([]);
  });
});

describe('rebuildIndex', () => {
  test('walks envelopes when index file is missing', async () => {
    const storage = createFakeStorage();
    // Write envelopes WITHOUT going through writeEnvelope (skip index update).
    await storage.setJson(envelopePath('mod-A'),
      envelopeFixture({ id: 'mod-A', uploaded_at: 100, module: moduleFixture({ id: 'mod-A', name: 'A' }) }),
      { userId: 'user-1' });
    await storage.setJson(envelopePath('mod-B'),
      envelopeFixture({ id: 'mod-B', uploaded_at: 200, module: moduleFixture({ id: 'mod-B', name: 'B' }) }),
      { userId: 'user-1' });

    const idx = await rebuildIndex(storage, 'user-1');
    expect(idx.entries.map((e) => e.id)).toEqual(['mod-B', 'mod-A']);
  });

  test('skips index.json itself + non-json files', async () => {
    const storage = createFakeStorage();
    await storage.setJson(envelopePath('mod-good'),
      envelopeFixture({ id: 'mod-good', module: moduleFixture({ id: 'mod-good' }) }),
      { userId: 'user-1' });
    // Stale index from a prior corrupted state.
    await storage.setJson('lumirealm/modules/index.json',
      { schema_version: MODULE_SCHEMA_VERSION, entries: [{ id: 'phantom' }] },
      { userId: 'user-1' });
    // Garbage file (not .json).
    await storage.write('lumirealm/modules/leftover.bin',
      new TextEncoder().encode('garbage'),
      'user-1');

    const idx = await rebuildIndex(storage, 'user-1');
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0]!.id).toBe('mod-good');
  });

  test('writes the rebuilt index to disk', async () => {
    const storage = createFakeStorage();
    await storage.setJson(envelopePath('mod-A'),
      envelopeFixture({ id: 'mod-A', module: moduleFixture({ id: 'mod-A' }) }),
      { userId: 'user-1' });
    await rebuildIndex(storage, 'user-1');
    const onDisk = await readIndex(storage, 'user-1');
    expect(onDisk.entries.length).toBe(1);
    expect(onDisk.entries[0]!.id).toBe('mod-A');
  });
});

describe('readIndex defensive paths', () => {
  test('returns empty index when file is missing', async () => {
    const storage = createFakeStorage();
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries).toEqual([]);
  });

  test('returns empty index when schema_version mismatches', async () => {
    const storage = createFakeStorage();
    await storage.setJson('lumirealm/modules/index.json',
      { schema_version: 999, entries: [{ id: 'x' }] },
      { userId: 'user-1' });
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries).toEqual([]);
  });

  test('returns empty index when entries is not an array', async () => {
    const storage = createFakeStorage();
    await storage.setJson('lumirealm/modules/index.json',
      { schema_version: MODULE_SCHEMA_VERSION, entries: 'not-an-array' },
      { userId: 'user-1' });
    const idx = await readIndex(storage, 'user-1');
    expect(idx.entries).toEqual([]);
  });
});

describe('writeIndex round-trip', () => {
  test('written index reads back identical', async () => {
    const storage = createFakeStorage();
    const idx: ModuleIndex = {
      schema_version: MODULE_SCHEMA_VERSION,
      entries: [
        {
          id: 'mod-1', filename: 'mod-1.risum', name: 'One', description: 'd',
          uploaded_at: 100, lorebook_count: 1, regex_count: 2, trigger_count: 3,
          asset_count: 4, low_level_access: false, has_cjs: false,
        },
      ],
    };
    await writeIndex(storage, 'user-1', idx);
    const back = await readIndex(storage, 'user-1');
    expect(back).toEqual(idx);
  });
});

describe('envelopePath', () => {
  test('returns lumirealm/modules/<id>.json', () => {
    expect(envelopePath('mod-A')).toBe('lumirealm/modules/mod-A.json');
  });
});

describe('pairModuleAssetsForUpload', () => {
  // Test stubs for the injected functions.
  const fakeBase64 = (b: Uint8Array): string => `b64(${Array.from(b).join(',')})`;
  const fakeMime = (name: string): string => `mime/${name.split('.').pop() ?? 'unknown'}`;

  test('pairs name with bytes by index and preserves the source asset index', () => {
    const manifest: readonly (readonly [string, string, string])[] = [
      ['reimu.png', '', 'hash1'],
      ['marisa.png', '', 'hash2'],
    ];
    const bytesList = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out).toEqual([
      {
        path: 'reimu.png',
        base64: 'b64(1,2,3)',
        mimeType: 'mime/png',
        sourceIndex: 0,
      },
      {
        path: 'marisa.png',
        base64: 'b64(4,5,6)',
        mimeType: 'mime/png',
        sourceIndex: 1,
      },
    ]);
  });

  test('empty inputs yield empty output', () => {
    expect(pairModuleAssetsForUpload([], [], fakeBase64, fakeMime)).toEqual([]);
  });

  test('truncates to min(manifest, bytesList) when lengths differ', () => {
    const manifest: readonly (readonly [string, string, string])[] = [
      ['a.png', '', 'h'],
      ['b.png', '', 'h'],
      ['c.png', '', 'h'],
    ];
    const bytesList = [new Uint8Array([1])];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.length).toBe(1);
    expect(out[0]!.path).toBe('a.png');
  });

  test('manifest longer than bytesList — extras dropped', () => {
    const manifest: readonly (readonly [string, string, string])[] = [['only.png', '', 'h']];
    const bytesList = [new Uint8Array([1]), new Uint8Array([2])];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.length).toBe(1);
  });

  test('skips entries with empty name', () => {
    const manifest: readonly (readonly [string, string, string])[] = [
      ['', '', ''],
      ['kept.png', '', 'h'],
    ];
    const bytesList = [new Uint8Array([0]), new Uint8Array([1])];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.length).toBe(1);
    expect(out[0]!.path).toBe('kept.png');
  });

  test('skips entries with non-string name (defensive against bad module shapes)', () => {
    // Cast the whole manifest through unknown to bypass tuple-shape
    // narrowing; the runtime guard is what matters here.
    const manifest = [
      [null, '', ''],
      ['ok.png', '', 'h'],
    ] as unknown as readonly (readonly [string, string, string])[];
    const bytesList = [new Uint8Array([0]), new Uint8Array([1])];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.length).toBe(1);
    expect(out[0]!.path).toBe('ok.png');
  });

  test('mime type is derived from injected mimeFor (per-name)', () => {
    const manifest: readonly (readonly [string, string, string])[] = [
      ['a.png', '', ''],
      ['b.mp4', '', ''],
      ['c.ogg', '', ''],
    ];
    const bytesList = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.map((p) => p.mimeType)).toEqual(['mime/png', 'mime/mp4', 'mime/ogg']);
  });

  test('does not mutate input arrays', () => {
    const manifest: readonly (readonly [string, string, string])[] = [['x.png', '', 'h']];
    const bytesList = [new Uint8Array([7])];
    const snapManifest = JSON.stringify(manifest);
    const snapBytes = Array.from(bytesList[0]!);
    pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(JSON.stringify(manifest)).toBe(snapManifest);
    expect(Array.from(bytesList[0]!)).toEqual(snapBytes);
  });

  test('handles 1485 assets (Touhou-Lightboard scale) without timing out', () => {
    const manifest: (readonly [string, string, string])[] = [];
    const bytesList: Uint8Array[] = [];
    for (let i = 0; i < 1485; i++) {
      manifest.push([`asset_${i}.png`, '', `hash_${i}`]);
      bytesList.push(new Uint8Array([i & 0xff]));
    }
    const out = pairModuleAssetsForUpload(manifest, bytesList, fakeBase64, fakeMime);
    expect(out.length).toBe(1485);
    expect(out[0]!.path).toBe('asset_0.png');
    expect(out[1484]!.path).toBe('asset_1484.png');
  });
});
