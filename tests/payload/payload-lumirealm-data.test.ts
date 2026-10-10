/**
 * Lumirealm extensions blob — type adapter unit tests.
 *
 * Phase 1 of the lumirealm refactor replaces the userStorage-based
 * `StoredRisuCard` envelope with a
 * `LumirealmCharacterData` blob persisted on `character.extensions['lumirealm']`.
 * These tests pin the shape of `buildLumirealmData` (translator output →
 * extensions blob) and `isLumirealmData` (the runtime narrowing predicate
 * used everywhere we read the blob, including the soft-remove case where
 * Lumi's shallow-merge writes a literal `null`).
 *
 * Pure — no userStorage / Spindle / Lumi dependency. Run with `bun test`.
 */

import { describe, test, expect } from 'bun:test';
import {
  buildLumirealmData,
  isLumirealmData,
} from '../../src/payload/codec.js';
import { LUMIREALM_EXT_KEY } from '../../src/payload/types.js';
import type {
  RisuPayload,
  StoredRegexScript,
} from '../../src/payload/types.js';

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

describe('LUMIREALM_EXT_KEY', () => {
  test('is the literal string "lumirealm"', () => {
    expect(LUMIREALM_EXT_KEY).toBe('lumirealm');
  });
});

describe('buildLumirealmData', () => {
  test('reshapes a minimal RisuPayload into the extensions blob', () => {
    const payload = makePayload();
    const data = buildLumirealmData(payload, '0.1.0', [], {}, {}, 1234567890);

    expect(data.schema_version).toBe(1);
    expect(data.imported_at).toBe(1234567890);
    expect(data.extension_version).toBe('0.1.0');
    expect(data.translator_version).toBe('test-1.2.3');
    expect(data.payload.triggers).toEqual([]);
    expect(data.payload.lua_scripts).toEqual([]);
    expect(data.payload.at_actions).toEqual([]);
    expect(data.payload.additional_assets).toEqual([]);
    expect(data.payload.emotion_images).toEqual([]);
    expect(data.payload.background_html).toBeNull();
    expect(data.payload.utility_bot).toBe(false);
    expect(data.payload.scriptstate_defaults).toEqual({});
    expect(data.payload.requires).toEqual({
      lowLevelAccess: false,
      hostFeatures: [],
      lua: false,
    });
    expect(data.asset_index).toEqual({});
    expect(data.emotion_index).toEqual({});
    expect(data.regex_scripts).toEqual([]);
    expect(data.user_overrides).toEqual({});
  });

  test('preserves background_html / utility_bot / scriptstate_defaults from RisuPayload (refactor regression fix)', () => {
    // These three fields were dropped in the original Phase 1 plan
    // assuming extensions.risuai would be populated by all import paths.
    // Our import path doesn't populate it → bg-html / utilityBot /
    // defaults silently lost on lumirealm-imported chars. Pin
    // round-trip so that doesn't regress again.
    const payload = makePayload({
      background_html: '<style>.foo{position:fixed}</style><div>full bg</div>',
      utility_bot: true,
      scriptstate_defaults: {
        jiyoon_current_icon: 'jiyoon_icon1.png',
        affection_total: '0',
        phase: 'A',
      },
    });
    const data = buildLumirealmData(payload, '0.1.0');
    expect(data.payload.background_html).toBe('<style>.foo{position:fixed}</style><div>full bg</div>');
    expect(data.payload.utility_bot).toBe(true);
    expect(data.payload.scriptstate_defaults).toEqual({
      jiyoon_current_icon: 'jiyoon_icon1.png',
      affection_total: '0',
      phase: 'A',
    });
  });

  test('preserves additional_assets and emotion_images metadata for post-upload merge', () => {
    const payload = makePayload({
      additional_assets: [
        { name: 'Foo', path: 'assets/foo.png', ext: 'png' },
        { name: 'Bar', path: 'assets/bar.webp', ext: 'webp' },
      ],
      emotion_images: [{ name: 'happy', path: 'emotions/happy.png', ext: 'png' }],
    });
    const data = buildLumirealmData(payload, '0.1.0');
    expect(data.payload.additional_assets).toEqual([
      { name: 'Foo', path: 'assets/foo.png', ext: 'png' },
      { name: 'Bar', path: 'assets/bar.webp', ext: 'webp' },
    ]);
    expect(data.payload.emotion_images).toEqual([
      { name: 'happy', path: 'emotions/happy.png', ext: 'png' },
    ]);
  });

  test('omits the untranslated subkey when payload has no diagnostic counters', () => {
    const data = buildLumirealmData(makePayload(), '0.1.0');
    expect('untranslated' in data.payload).toBe(false);
  });

  test('preserves untranslated counters when present', () => {
    const payload = makePayload({
      untranslated: { utility_bot: true, display_trigger_semantics_shifted: 3 },
    });
    const data = buildLumirealmData(payload, '0.1.0');
    expect(data.payload.untranslated).toEqual({
      utility_bot: true,
      display_trigger_semantics_shifted: 3,
    });
  });

  test('drops only the truly-redundant fields (virtualscript, extra, risu_spec_version) — keeps runtime-load-bearing ones', () => {
    const payload = makePayload({
      background_html: '<div>card bg</div>',
      utility_bot: true,
      scriptstate_defaults: { phase: 'A' },
      virtualscript: 'legacy',
      extra: { backgroundHTML: '<duplicate />' },
    });
    const data = buildLumirealmData(payload, '0.1.0');
    const dataAny = data as unknown as Record<string, unknown>;
    // Top-level: only metadata + payload + indexes + regex + overrides.
    expect(dataAny['background_html']).toBeUndefined();
    expect(dataAny['utility_bot']).toBeUndefined();
    expect(dataAny['scriptstate_defaults']).toBeUndefined();
    // Truly dropped (unused at runtime + no recovery path):
    expect(dataAny['virtualscript']).toBeUndefined();
    expect(dataAny['extra']).toBeUndefined();
    expect(dataAny['risu_spec_version']).toBeUndefined();
    // payload subtree is where translator output for runtime lives:
    const payloadAny = data.payload as unknown as Record<string, unknown>;
    // RESTORED 2026-04-27 regression fix — these were originally dropped
    // expecting extensions.risuai to carry them, but our import path
    // doesn't populate risuai. Without these, lumirealm-imported chars
    // had no bg-html (clear_bg_html → activeRisuChatId nulled → button
    // clicks rejected) and `getChatVar` lost its default fallback.
    expect(payloadAny['background_html']).toBeDefined();
    expect(payloadAny['utility_bot']).toBeDefined();
    expect(payloadAny['scriptstate_defaults']).toBeDefined();
    // additional_assets / emotion_images STAY (needed by registerAssetIndex
    // for path↔name mapping at register-asset-index time; not read at
    // runtime — runtime uses asset_index).
    expect(payloadAny['additional_assets']).toBeDefined();
    expect(payloadAny['emotion_images']).toBeDefined();
  });

  test('passes through asset_index / emotion_index / regex_scripts arguments', () => {
    const stub: StoredRegexScript = {
      name: 'rule-A',
      script_id: 'sid-1',
      find_regex: 'foo',
      replace_string: 'bar',
      flags: 'g',
      placement: ['ai_output'],
      scope: 'character',
      scope_id: 'char-1',
      target: 'display',
      min_depth: null,
      max_depth: null,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: 'raw',
      disabled: false,
      sort_order: 0,
      description: '',
      folder: '',
    };
    const data = buildLumirealmData(
      makePayload(),
      '0.1.0',
      [stub],
      { foo: { imageIds: ['img-1'], ext: 'png' } },
      { happy: { imageIds: ['img-2'] } },
    );
    expect(data.regex_scripts).toEqual([stub]);
    expect(data.asset_index).toEqual({ foo: { imageIds: ['img-1'], ext: 'png' } });
    expect(data.emotion_index).toEqual({ happy: { imageIds: ['img-2'] } });
  });

  test('user_overrides starts empty (populated later by config UI clicks)', () => {
    const data = buildLumirealmData(makePayload(), '0.1.0');
    expect(data.user_overrides).toEqual({});
    // Optional subfields all undefined until first edit
    expect(data.user_overrides.utility_bot_override).toBeUndefined();
    expect(data.user_overrides.low_level_access_granted).toBeUndefined();
    expect(data.user_overrides.attached_module_ids).toBeUndefined();
  });
});

describe('isLumirealmData', () => {
  test('accepts a fresh buildLumirealmData output', () => {
    const data = buildLumirealmData(makePayload(), '0.1.0');
    expect(isLumirealmData(data)).toBe(true);
  });

  test('rejects null (the soft-remove sentinel from Lumi shallow-merge)', () => {
    // Lumi-side: `update({ extensions: { lumirealm: null } })` does
    // `{ ...existing, ...input }` so the key persists with literal null.
    // We treat null === absent so the soft-remove path doesn't accidentally
    // re-activate after a write that intended to clear.
    expect(isLumirealmData(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(isLumirealmData(undefined)).toBe(false);
  });

  test('rejects non-object primitives', () => {
    expect(isLumirealmData('hello')).toBe(false);
    expect(isLumirealmData(42)).toBe(false);
    expect(isLumirealmData(true)).toBe(false);
  });

  test('rejects an empty object (no schema_version)', () => {
    expect(isLumirealmData({})).toBe(false);
  });

  test('rejects mismatched schema_version', () => {
    expect(isLumirealmData({ schema_version: 0 })).toBe(false);
    expect(isLumirealmData({ schema_version: 2 })).toBe(false);
    expect(isLumirealmData({ schema_version: '1' })).toBe(false);
  });

  test('rejects arrays', () => {
    expect(isLumirealmData([])).toBe(false);
    expect(isLumirealmData([{ schema_version: 1 }])).toBe(false);
  });

  test('schema_version === 1 is the only acceptance gate (deeper validation is the caller s job)', () => {
    // We don't deep-validate the shape — that would be expensive on every
    // ensureActiveCardForChat. Caller can rely on `data.payload?.triggers`
    // etc. being present for a blob we wrote ourselves; corrupt blobs
    // surface as runtime errors at use time, which is fine.
    expect(isLumirealmData({ schema_version: 1 })).toBe(true);
  });
});
