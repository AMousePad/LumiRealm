/**
 * Import pipeline end-to-end with mock spindle + mock userStorage.
 * Proves the translator → characters.create → spindle.characters.update
 * (extensions['lumirealm']) path lands a LumirealmCharacterData blob
 * with the right shape + surfaces pending assets for frontend upload.
 *
 * Updated for the lumirealm storage refactor: storage moved from
 * `risu-compat/characters/<id>.json` userStorage to
 * `character.extensions['lumirealm']` blob persisted via
 * spindle.characters.{create,update}.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { translateCharx } from '../../src/core/pipeline/translate.js';
import { listLibraryCards } from '../helpers/local-library.js';
import { importCard, type SpindleImportApi } from '../../src/payload/import.js';
import type { UserStorageLike } from '../../src/payload/installer.js';
import { LUMIREALM_EXT_KEY, type LumirealmCharacterData } from '../../src/payload/types.js';
import { isLumirealmData, RisuConsentDeclinedError } from '../../src/payload/codec.js';

// ─── Mock userStorage (kept for legacy importer surface; lumirealm now
//     persists to character.extensions, but the type still requires it) ──

function makeMockStorage(): UserStorageLike & { _store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    async getJson<T>(path: string, opts?: { fallback?: T }) {
      if (store.has(path)) return store.get(path) as T;
      return (opts?.fallback ?? null) as T;
    },
    async setJson(path: string, value: unknown) { store.set(path, value); },
    async delete(path: string) { store.delete(path); },
  };
}

function makeMockSpindle(): SpindleImportApi & {
  _characters: Record<string, Record<string, unknown>>;
  _worldBooks: Record<string, string>;
  _entries: Record<string, Record<string, unknown>>;
  _imageUploads: { filename?: string; mimeType?: string; bytes: number }[];
} {
  let nextId = 1;
  const characters: Record<string, Record<string, unknown>> = {};
  const worldBooks: Record<string, string> = {};
  const entries: Record<string, Record<string, unknown>> = {};
  const imageUploads: { filename?: string; mimeType?: string; bytes: number }[] = [];
  return {
    _characters: characters,
    _worldBooks: worldBooks,
    _entries: entries,
    _imageUploads: imageUploads,
    characters: {
      async create(input) {
        const id = 'char-' + nextId++;
        characters[id] = { ...input, id, extensions: input['extensions'] ?? {} };
        return { id };
      },
      async setAvatar(characterId, avatar) {
        const existing = characters[characterId];
        if (!existing) throw new Error('Character not found');
        const id = 'img-' + nextId++;
        imageUploads.push({
          ...(avatar.filename !== undefined ? { filename: avatar.filename } : {}),
          ...(avatar.mime_type !== undefined ? { mimeType: avatar.mime_type } : {}),
          bytes: avatar.data.byteLength,
        });
        return { id, image_id: id };
      },
      async update(characterId, input) {
        const existing = characters[characterId];
        if (!existing) throw new Error('Character not found');
        if (input['extensions'] !== undefined) {
          existing['extensions'] = {
            ...((existing['extensions'] as Record<string, unknown>) ?? {}),
            ...(input['extensions'] as Record<string, unknown>),
          };
        }
        for (const k of Object.keys(input)) {
          if (k === 'extensions') continue;
          existing[k] = input[k];
        }
        return existing;
      },
    },
    world_books: {
      async create(input) {
        const id = 'wb-' + nextId++;
        worldBooks[id] = typeof input['name'] === 'string' ? input['name'] : '';
        return { id };
      },
      async update(_worldBookId: string, _input: Record<string, unknown>) {
        // No-op for test purposes — caller doesn't read the response.
        return undefined;
      },
      entries: {
        async create(worldBookId, input) {
          const id = 'wbe-' + nextId++;
          entries[id] = { ...input, worldBookId };
          return { id };
        },
      },
    },
    images: {
      async uploadMany(items) {
        return items.map((input) => {
          const id = 'img-' + nextId++;
          imageUploads.push({
            ...(input.filename !== undefined ? { filename: input.filename } : {}),
            ...(input.mime_type !== undefined ? { mimeType: input.mime_type } : {}),
            bytes: input.data.byteLength,
          });
          return { id };
        });
      },
    },
  };
}

// ─── Fixture: pick a real corpus card ────────────────────────────────────────

function pickCorpusCard(): string | null {
  const cards = listLibraryCards();
  return cards.length > 0 ? cards[0]! : null;
}

describe('import_card — full pipeline (lumirealm storage)', () => {
  const sampleCharxPath = pickCorpusCard();
  if (!sampleCharxPath) {
    test.skip('no corpus card available — skip', () => {});
    return;
  }

  test('translates, creates character, writes extensions[lumirealm], reports pending assets', async () => {
    const charxBytes = readFileSync(sampleCharxPath);
    const storage = makeMockStorage();
    const spindle = makeMockSpindle();
    const progress: string[] = [];

    const result = await importCard({
      bytes: charxBytes,
      fileName: 'fixture.charx',
      extensionVersion: '0.1.0-test',
      userId: 'test-uid',
      spindle,
      userStorage: storage,
      onProgress: (_phase, message) => { progress.push(message); },
    });

    expect(result.characterId).toMatch(/^char-\d+$/);
    expect(result.characterName.length).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(3);

    expect(spindle._characters[result.characterId]).toBeDefined();
    const createdChar = spindle._characters[result.characterId]!;
    expect(createdChar['name']).toBe(result.characterName);

    const ext = createdChar['extensions'] as Record<string, unknown>;
    const blob = ext[LUMIREALM_EXT_KEY];
    expect(isLumirealmData(blob)).toBe(true);
    const data = blob as LumirealmCharacterData;
    expect(data.schema_version).toBe(1);
    expect(data.extension_version).toBe('0.1.0-test');
    expect(data.translator_version).toBeTypeOf('string');
    expect(Array.isArray(data.payload.triggers)).toBe(true);
    expect(Array.isArray(data.payload.lua_scripts)).toBe(true);

    expect(result.lumirealm.schema_version).toBe(1);
    expect(result.lumirealm).toEqual(data);

    expect(Array.isArray(result.imageIds)).toBe(true);
    expect(result.imageIds.length).toBe(spindle._imageUploads.length);
    for (const id of result.imageIds) {
      expect(id).toMatch(/^img-\d+$/);
    }
    for (const up of spindle._imageUploads) {
      expect(up.bytes).toBeGreaterThan(0);
    }
  });

  test('does NOT prompt for consent when card declares no lowLevelAccess', async () => {
    // The fixture corpus card we picked is a low-level-access-free card
    // (most of the corpus is). Mock modal records calls so we can assert
    // the prompt never fires.
    const charxBytes = readFileSync(sampleCharxPath);
    const storage = makeMockStorage();
    const spindle = makeMockSpindle();
    let modalCalls = 0;
    const spindleWithModal: SpindleImportApi = {
      ...spindle,
      async requestConsent() {
        modalCalls++;
        return { confirmed: true };
      },
    };
    const result = await importCard({
      bytes: charxBytes,
      fileName: 'no-consent.charx',
      extensionVersion: '0.1.0-test',
      userId: 'test-uid',
      spindle: spindleWithModal,
      userStorage: storage,
    });
    expect(modalCalls).toBe(0);
    // user_overrides empty when no consent flow ran.
    expect(result.lumirealm.user_overrides).toEqual({});
  });

  test('loud-fails on a downstream Spindle failure', async () => {
    const charxBytes = readFileSync(sampleCharxPath);
    const storage = makeMockStorage();
    const spindle: SpindleImportApi = {
      characters: {
        async create() {
          throw new Error('simulated downstream failure');
        },
        async setAvatar() { throw new Error('not reachable'); },
        async update() { throw new Error('not reachable'); },
      },
      world_books: {
        async create() { throw new Error('not reachable'); },
        async update() { throw new Error('not reachable'); },
        entries: {
          async create() { throw new Error('not reachable'); },
        },
      },
      images: {
        async uploadMany() { throw new Error('not reachable'); },
      },
    };
    await expect(
      importCard({
        bytes: charxBytes,
        fileName: 'fail.charx',
        extensionVersion: '0.1.0-test',
        userId: 'test-uid',
        spindle,
        userStorage: storage,
      }),
    ).rejects.toThrow(/simulated downstream failure/);
  });
});

// ─── P0.3 — low-level access consent flow ───────────────────────────────
//
// Mirrors Risu's import-time `alertConfirm(language.lowLevelAccessConfirm)`
// in Risu's card import flow.
// When `requires.lowLevelAccess === true`, the importer prompts via
// `spindle.modal.confirm` and:
//   - decline → throws RisuConsentDeclinedError, no character row created
//   - accept → user_overrides.low_level_access_granted = true,
//              consent_acknowledged_at = ms-since-epoch
//
// Fixture: any library card whose translation declares lowLevelAccess.
// Skips when the library has no such card.

function pickLowLevelCorpusCard(): string | null {
  for (const p of listLibraryCards().slice(0, 300)) {
    try {
      const bundle = translateCharx(new Uint8Array(readFileSync(p)), {
        mode: 'diagnostic',
        includeAssets: false,
      });
      if (bundle.risuPayload?.requires?.lowLevelAccess === true) return p;
    } catch {
      continue;
    }
  }
  return null;
}

describe('import_card — P0.3 low-level access consent', () => {
  const path = pickLowLevelCorpusCard();
  if (!path) {
    test.skip('no lowLevelAccess corpus card available — skip', () => {});
    return;
  }
  const charxBytes = readFileSync(path);

  test('prompts and aborts with RisuConsentDeclinedError when user declines', async () => {
    const storage = makeMockStorage();
    const spindle = makeMockSpindle();
    let modalCalls = 0;
    const spindleWithModal: SpindleImportApi = {
      ...spindle,
      async requestConsent(opts) {
        modalCalls++;
        expect(opts.title.length).toBeGreaterThan(0);
        expect(opts.message.length).toBeGreaterThan(0);
        expect(opts.message).toMatch(/low-level/i);
        return { confirmed: false };
      },
    };
    await expect(
      importCard({
        bytes: charxBytes,
        fileName: 'low-level.charx',
        extensionVersion: '0.1.0-test',
        userId: 'test-uid',
        spindle: spindleWithModal,
        userStorage: storage,
      }),
    ).rejects.toBeInstanceOf(RisuConsentDeclinedError);
    expect(modalCalls).toBe(1);
    // No character row was created — abort happened before (4b).
    expect(Object.keys(spindle._characters)).toHaveLength(0);
  });

  test('proceeds and records consent when user accepts', async () => {
    const storage = makeMockStorage();
    const spindle = makeMockSpindle();
    const spindleWithModal: SpindleImportApi = {
      ...spindle,
      async requestConsent() { return { confirmed: true }; },
    };
    const result = await importCard({
      bytes: charxBytes,
      fileName: 'low-level.charx',
      extensionVersion: '0.1.0-test',
      userId: 'test-uid',
      spindle: spindleWithModal,
      userStorage: storage,
    });
    // Character row landed.
    expect(spindle._characters[result.characterId]).toBeDefined();
    // Consent recorded in user_overrides.
    expect(result.lumirealm.user_overrides.low_level_access_granted).toBe(true);
    expect(result.lumirealm.user_overrides.consent_acknowledged_at).toBeGreaterThan(0);
  });

  test('refuses by default when no modal surface is available', async () => {
    // No `modal` field on the spindle — refuse rather than silently
    // grant. The default-deny stance is the safer fallback for hosts
    // that don't expose `spindle.modal.confirm`.
    const storage = makeMockStorage();
    const spindle = makeMockSpindle();
    await expect(
      importCard({
        bytes: charxBytes,
        fileName: 'low-level.charx',
        extensionVersion: '0.1.0-test',
        userId: 'test-uid',
        spindle, // no modal
        userStorage: storage,
      }),
    ).rejects.toBeInstanceOf(RisuConsentDeclinedError);
    expect(Object.keys(spindle._characters)).toHaveLength(0);
  });
});
