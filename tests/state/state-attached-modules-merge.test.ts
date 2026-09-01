/**
 * Pin behaviour of `mergeAttachedModulesIntoPayload` +
 * `buildSyntheticStoredCard` when attached modules are passed in.
 *
 * Modules contribute triggers, parallel Lua bodies, and assets to the
 * runtime view. Lorebook + regex DON'T pass through the synthesizer
 * (those go to Lumi's tables at attach time via cookie-auth round-trip).
 *
 * Apply-order semantics:
 *   - Triggers append AFTER the character's own (later modules append
 *     after earlier ones).
 *   - Lua scripts stay parallel-indexed.
 *   - Asset names: character > later module > earlier module on
 *     collision.
 *   - `requires.lowLevelAccess` becomes the OR of base + every module.
 */

import { describe, test, expect } from 'bun:test';
import {
  type AttachedModuleForRuntime,
  buildSyntheticStoredCard,
  mergeAttachedModulesIntoPayload,
} from '../../src/state/lumirealm-character.js';
import type {
  AssetIndexEntry,
  LumirealmCharacterData,
  RisuPayload,
} from '../../src/payload/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────────

function basePayload(overrides: Partial<RisuPayload> = {}): RisuPayload {
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
    translator_version: 'test-v1',
    risu_spec_version: '',
    requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
    ...overrides,
  };
}

function modFixture(over: Partial<AttachedModuleForRuntime> = {}): AttachedModuleForRuntime {
  return {
    id: 'mod-A',
    triggers: [],
    lua_scripts: [],
    lorebook: [],
    asset_index: {},
    low_level_access: false,
    ...over,
  };
}

function lumirealmFixture(payload: RisuPayload): LumirealmCharacterData {
  return {
    schema_version: 1,
    imported_at: 100,
    extension_version: '0.1.0',
    translator_version: payload.translator_version,
    payload: {
      triggers: payload.triggers,
      lua_scripts: payload.lua_scripts,
      at_actions: payload.at_actions,
      additional_assets: [],
      emotion_images: [],
      background_html: payload.background_html,
      utility_bot: payload.utility_bot,
      scriptstate_defaults: payload.scriptstate_defaults,
      requires: payload.requires,
    },
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    user_overrides: {},
  };
}

// ─── mergeAttachedModulesIntoPayload — pure helper ───────────────────

describe('mergeAttachedModulesIntoPayload — empty modules is a no-op', () => {
  test('returns the same shapes as input when modules array is empty', () => {
    const p = basePayload({
      triggers: ['t-char'],
      lua_scripts: ['lua-char'],
    });
    const baseAssets = { reimu: { imageIds: ['img-1'] } };
    const out = mergeAttachedModulesIntoPayload(p, baseAssets, []);
    expect(out.triggers).toBe(p.triggers);
    expect(out.lua_scripts).toBe(p.lua_scripts);
    expect(out.asset_index).toBe(baseAssets);
    expect(out.requires).toBe(p.requires);
  });
});

describe('mergeAttachedModulesIntoPayload — trigger append + parallel lua', () => {
  test('module triggers append AFTER character triggers', () => {
    const p = basePayload({
      triggers: ['t-char-1', 't-char-2'],
      lua_scripts: ['lua-char-1', 'lua-char-2'],
    });
    const m = modFixture({
      id: 'mod-X',
      triggers: ['t-mod-1', 't-mod-2'],
      lua_scripts: ['lua-mod-1', 'lua-mod-2'],
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.triggers).toEqual(['t-char-1', 't-char-2', 't-mod-1', 't-mod-2']);
    expect(out.lua_scripts).toEqual(['lua-char-1', 'lua-char-2', 'lua-mod-1', 'lua-mod-2']);
  });

  test('apply order: earlier module triggers come BEFORE later ones', () => {
    const p = basePayload();
    const earlier = modFixture({ id: 'first', triggers: ['t-first'], lua_scripts: ['l-first'] });
    const later = modFixture({ id: 'second', triggers: ['t-second'], lua_scripts: ['l-second'] });
    const out = mergeAttachedModulesIntoPayload(p, {}, [earlier, later]);
    expect(out.triggers).toEqual(['t-first', 't-second']);
    expect(out.lua_scripts).toEqual(['l-first', 'l-second']);
  });

  test('module without lua entry pads lua_scripts with empty string at the same index', () => {
    const p = basePayload();
    const m = modFixture({
      triggers: ['a', 'b', 'c'],
      lua_scripts: [], // shorter than triggers — runtime contract is parallel arrays
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.triggers.length).toBe(3);
    expect(out.lua_scripts.length).toBe(3);
    expect(out.lua_scripts).toEqual(['', '', '']);
  });

  test('module runtime actions append after the character actions', () => {
    const p = basePayload({ at_actions: [{ action: 'char-action' }] });
    const m = modFixture({
      at_actions: [{ action: 'emo', sourceOrigin: 'module:mod-X' }],
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.at_actions).toEqual([
      { action: 'char-action' },
      { action: 'emo', sourceOrigin: 'module:mod-X' },
    ]);
  });
});

describe('mergeAttachedModulesIntoPayload — asset_index merge precedence', () => {
  test('character asset wins over module on name collision', () => {
    const p = basePayload();
    const baseAssets: Record<string, AssetIndexEntry> = {
      shared: { imageIds: ['char-img'] },
    };
    const m = modFixture({
      asset_index: {
        shared: { imageIds: ['mod-img'] },
        unique: { imageIds: ['mod-uniq'] },
      },
    });
    const out = mergeAttachedModulesIntoPayload(p, baseAssets, [m]);
    expect(out.asset_index.shared).toEqual({ imageIds: ['char-img'] });
    expect(out.asset_index.unique).toEqual({ imageIds: ['mod-uniq'] });
  });

  test('later module wins over earlier on collision (when character has no claim)', () => {
    const p = basePayload();
    const earlier = modFixture({
      id: 'first',
      asset_index: { contested: { imageIds: ['from-first'] } },
    });
    const later = modFixture({
      id: 'second',
      asset_index: { contested: { imageIds: ['from-second'] } },
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [earlier, later]);
    expect(out.asset_index.contested).toEqual({ imageIds: ['from-second'] });
  });

  test('asset ext is preserved when present', () => {
    const p = basePayload();
    const m = modFixture({
      asset_index: { vid: { imageIds: ['vid-img'], ext: 'mp4' } },
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.asset_index.vid).toEqual({ imageIds: ['vid-img'], ext: 'mp4' });
  });
});

describe('mergeAttachedModulesIntoPayload — requires folding', () => {
  test('lowLevelAccess becomes OR of base + every module', () => {
    const p = basePayload();
    const m1 = modFixture({ low_level_access: false });
    const m2 = modFixture({ low_level_access: true });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m1, m2]);
    expect(out.requires.lowLevelAccess).toBe(true);
  });

  test('lowLevelAccess stays false when nothing flags it', () => {
    const p = basePayload();
    const m = modFixture({ low_level_access: false });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.requires.lowLevelAccess).toBe(false);
  });

  test('module with lua triggers folds lua=true into requires', () => {
    const p = basePayload({ requires: { lua: false, lowLevelAccess: false, hostFeatures: [] } });
    const m = modFixture({
      triggers: ['t1'],
      lua_scripts: ['print("hi")'],
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.requires.lua).toBe(true);
  });

  test('module with triggers but no lua bodies does NOT flip requires.lua', () => {
    const p = basePayload();
    const m = modFixture({
      triggers: ['t1'],
      lua_scripts: [''], // empty lua body
    });
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.requires.lua).toBe(false);
  });

  test('hostFeatures pass through unchanged from base', () => {
    const p = basePayload({
      requires: { lua: false, lowLevelAccess: false, hostFeatures: ['alertSelect'] },
    });
    const m = modFixture({});
    const out = mergeAttachedModulesIntoPayload(p, {}, [m]);
    expect(out.requires.hostFeatures).toEqual(['alertSelect']);
  });
});

// ─── buildSyntheticStoredCard with attached modules ──────────────────

describe('buildSyntheticStoredCard — attached modules contribute to runtime card', () => {
  test('module triggers/lua/assets land on the synthesized card', () => {
    const data = lumirealmFixture(basePayload({
      triggers: ['t-char'],
      lua_scripts: ['lua-char'],
    }));
    const m: AttachedModuleForRuntime = {
      id: 'mod-Z',
      triggers: ['t-mod'],
      lua_scripts: ['lua-mod'],
      lorebook: [],
      asset_index: { mod_asset: { imageIds: ['img-z'] } },
      low_level_access: true,
    };
    const card = buildSyntheticStoredCard('char-1', data, {}, [m]);
    expect(card.risuPayload.triggers).toEqual(['t-char', 't-mod']);
    expect(card.risuPayload.lua_scripts).toEqual(['lua-char', 'lua-mod']);
    expect(card.risuPayload.at_actions).toEqual([]);
    expect(card.asset_index.mod_asset).toEqual({ imageIds: ['img-z'] });
    expect(card.risuPayload.requires.lowLevelAccess).toBe(true);
  });

  test('attached_modules diagnostic is recorded on extra when modules present', () => {
    const data = lumirealmFixture(basePayload({
      triggers: ['t-char-1', 't-char-2'],
      lua_scripts: ['', ''],
    }));
    const m: AttachedModuleForRuntime = modFixture({ id: 'mod-DIAG' });
    const card = buildSyntheticStoredCard('char-1', data, {}, [m]);
    expect(card.risuPayload.extra['attached_modules']).toEqual(['mod-DIAG']);
    expect(
      card.risuPayload.extra['runtime_module_library_order'],
    ).toEqual(['mod-DIAG']);
    expect(card.risuPayload.extra['base_trigger_count']).toBe(2);
    expect(card.risuPayload.extra['base_lua_count']).toBe(2);
  });

  test('raw module lore is retained only on the synthetic runtime payload', () => {
    const data = lumirealmFixture(basePayload());
    const lore = [{ id: 'raw-entry', content: '@@recursive\nbody' }];
    const card = buildSyntheticStoredCard(
      'char-1',
      data,
      {},
      [modFixture({ id: 'mod-lore', lorebook: lore })],
    );

    expect(card.risuPayload.extra['runtime_module_lorebooks']).toEqual({
      'mod-lore': lore,
    });
    expect(data.payload).not.toHaveProperty('runtime_module_lorebooks');
  });

  test('replacement-module runtime identity retains old handle and resolved ID', () => {
    const data = lumirealmFixture(basePayload());
    const card = buildSyntheticStoredCard(
      'char-1',
      data,
      {},
      [modFixture({
        id: 'module-new-id',
        attachment_handles: ['module-old-id'],
        namespace: 'module-old-id',
      })],
    );

    expect(card.risuPayload.extra['runtime_module_identities']).toEqual({
      'module-new-id': {
        persisted_handles: ['module-old-id'],
        aliases: ['module-old-id'],
      },
    });
    expect(data.payload).not.toHaveProperty('runtime_module_identities');
  });

  test('no attached modules → extra stays empty (no diagnostic noise)', () => {
    const data = lumirealmFixture(basePayload());
    const card = buildSyntheticStoredCard('char-1', data, {});
    expect(card.risuPayload.extra).toEqual({});
  });

  test('character asset_index wins over module on name collision', () => {
    const data = lumirealmFixture(basePayload());
    // Inject a character-level asset directly on the data shape.
    const dataWithAsset: LumirealmCharacterData = {
      ...data,
      asset_index: { shared: { imageIds: ['char-shared'] } },
    };
    const m: AttachedModuleForRuntime = modFixture({
      asset_index: { shared: { imageIds: ['mod-shared'] } },
    });
    const card = buildSyntheticStoredCard('char-1', dataWithAsset, {}, [m]);
    expect(card.asset_index.shared).toEqual({ imageIds: ['char-shared'] });
  });

  test('multiple modules append in order; later-module trigger sits later', () => {
    const data = lumirealmFixture(basePayload());
    const a: AttachedModuleForRuntime = modFixture({ id: 'a', triggers: ['from-a'], lua_scripts: [''] });
    const b: AttachedModuleForRuntime = modFixture({ id: 'b', triggers: ['from-b'], lua_scripts: [''] });
    const card = buildSyntheticStoredCard('char-1', data, {}, [a, b]);
    expect(card.risuPayload.triggers).toEqual(['from-a', 'from-b']);
  });

  test('module asset shape (single imageId) is preserved as multi-source AssetIndexEntry shape', () => {
    // The merge-helper consumes AttachedModuleForRuntime which already
    // expects the imageIds[] shape (the projection from envelope happens
    // upstream in backend.ts loadAttachedModulesForRuntime).
    const data = lumirealmFixture(basePayload());
    const m: AttachedModuleForRuntime = modFixture({
      asset_index: { x: { imageIds: ['only-one'], ext: 'png' } },
    });
    const card = buildSyntheticStoredCard('char-1', data, {}, [m]);
    expect(card.asset_index.x).toEqual({ imageIds: ['only-one'], ext: 'png' });
  });
});

// ─── module_background_embedding concatenation (Risu modules.ts:501-516) ──

describe('mergeAttachedModulesIntoPayload — backgroundEmbedding concat', () => {
  test('no modules → empty string', () => {
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, []);
    expect(out.module_background_embedding).toBe('');
  });

  test('module without backgroundEmbedding contributes nothing', () => {
    const m = modFixture({ id: 'no-embed' }); // no background_embedding field
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect(out.module_background_embedding).toBe('');
  });

  test('single module: \\n + body + \\n sandwich (Risu modules.ts:511 pattern)', () => {
    const m = modFixture({
      id: 'only',
      background_embedding: '<style>.x{color:red}</style>',
    });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect(out.module_background_embedding).toBe('\n<style>.x{color:red}</style>\n');
  });

  test('multiple modules concatenate in attach order, each with own newline-sandwich', () => {
    const a = modFixture({ id: 'a', background_embedding: 'AAA' });
    const b = modFixture({ id: 'b', background_embedding: 'BBB' });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [a, b]);
    expect(out.module_background_embedding).toBe('\nAAA\n\nBBB\n');
  });

  test('mixed: some modules have embeddings, others don\'t — only embedded ones contribute', () => {
    const a = modFixture({ id: 'a', background_embedding: 'AAA' });
    const noEmbed = modFixture({ id: 'no-embed' });
    const c = modFixture({ id: 'c', background_embedding: 'CCC' });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [a, noEmbed, c]);
    expect(out.module_background_embedding).toBe('\nAAA\n\nCCC\n');
  });

  test('empty-string embedding is treated as absent (parity with Risu truthy check)', () => {
    const m = modFixture({ id: 'empty', background_embedding: '' });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect(out.module_background_embedding).toBe('');
  });
});

// ─── lowLevelAccess flag overlay on per-trigger objects ──────────────────
//
// Risu sets `t.lowLevelAccess = module.lowLevelAccess` for every trigger
// originating from a low-level module (modules.ts:407-411), so the
// per-effect runtime gate (triggers.ts:1469+) sees the inherited
// permission. We mirror via shallow-clone.

describe('mergeAttachedModulesIntoPayload — lowLevelAccess flag overlay', () => {
  test('module low_level_access=true overlays lowLevelAccess:true on every pushed trigger', () => {
    const m = modFixture({
      id: 'low-level-mod',
      triggers: [{ kind: 't', op: 'noop' }, { kind: 't', op: 'noop2' }],
      lua_scripts: ['', ''],
      low_level_access: true,
    });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    // First two are character's; module triggers come AFTER.
    expect(out.triggers).toHaveLength(2);
    expect((out.triggers[0] as { lowLevelAccess?: boolean }).lowLevelAccess).toBe(true);
    expect((out.triggers[1] as { lowLevelAccess?: boolean }).lowLevelAccess).toBe(true);
  });

  test('module low_level_access=false does NOT inject the flag (preserves trigger\'s own value)', () => {
    const m = modFixture({
      id: 'plain-mod',
      triggers: [{ kind: 't', existing: 'unrelated' }],
      lua_scripts: [''],
      low_level_access: false,
    });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect(out.triggers).toHaveLength(1);
    // No lowLevelAccess field added — trigger object is pushed verbatim.
    expect(out.triggers[0]).toEqual({ kind: 't', existing: 'unrelated' });
  });

  test('overlay is non-destructive: source trigger object is NOT mutated', () => {
    const sourceTrig = { kind: 'a' };
    const m = modFixture({
      id: 'src-mut-check',
      triggers: [sourceTrig],
      lua_scripts: [''],
      low_level_access: true,
    });
    mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect((sourceTrig as { lowLevelAccess?: boolean }).lowLevelAccess).toBeUndefined();
  });

  test('non-object triggers (defensive) are passed through without overlay', () => {
    const m = modFixture({
      id: 'weird-mod',
      triggers: ['string-trigger', null, 42 as unknown as object],
      lua_scripts: ['', '', ''],
      low_level_access: true,
    });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [m]);
    expect(out.triggers).toEqual(['string-trigger', null, 42]);
  });

  test('folded requires.lowLevelAccess is OR of base + any module flag', () => {
    const lowMod = modFixture({ id: 'low', low_level_access: true });
    const out = mergeAttachedModulesIntoPayload(basePayload(), {}, [lowMod]);
    expect(out.requires.lowLevelAccess).toBe(true);
  });
});

describe('buildSyntheticStoredCard — module_background_embedding surfaces on risuPayload', () => {
  test('attached module with backgroundEmbedding sets the field on the synthesized payload', () => {
    const data = lumirealmFixture(basePayload());
    const m = modFixture({
      id: 'styler',
      background_embedding: '<style>.chattext-x{display:none}</style>',
    });
    const card = buildSyntheticStoredCard('char-1', data, {}, [m]);
    expect(card.risuPayload.module_background_embedding).toBe(
      '\n<style>.chattext-x{display:none}</style>\n',
    );
  });

  test('no attached modules → field is undefined (kept off the wire to avoid noise)', () => {
    const data = lumirealmFixture(basePayload());
    const card = buildSyntheticStoredCard('char-1', data, {}, []);
    expect(card.risuPayload.module_background_embedding).toBeUndefined();
  });

  test('attached modules but no embeddings → field is undefined', () => {
    const data = lumirealmFixture(basePayload());
    const m = modFixture({ id: 'no-embed' });
    const card = buildSyntheticStoredCard('char-1', data, {}, [m]);
    expect(card.risuPayload.module_background_embedding).toBeUndefined();
  });
});
