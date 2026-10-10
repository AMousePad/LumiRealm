/**
 * Pin behaviour of the read-only viewer-data assemblers
 * (`buildCharacterViewerData`, `buildModuleViewerData`).
 *
 * Both produce the same wire shape (`ViewerData`) — UI is
 * source-agnostic. Asset URLs always point at `/api/v1/images/<id>`.
 * Multi-source assets pick the FIRST id and flag `multi: true`.
 */

import { describe, test, expect } from 'bun:test';
import {
  buildCharacterViewerData,
  buildModuleViewerData,
  type FetchedWorldBook,
  type LumiSideRegex,
} from '../../src/state/viewer-data.js';
import type { LumirealmCharacterData, StoredRegexScript } from '../../src/payload/types.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';
import { MODULE_SCHEMA_VERSION } from '../../src/state/modules-store.js';

// ─── Fixtures ──────────────────────────────────────────────────────────

function lumirealmFixture(over: Partial<LumirealmCharacterData> = {}): LumirealmCharacterData {
  return {
    schema_version: 1,
    imported_at: 1,
    extension_version: '0.1',
    translator_version: 't1',
    payload: {
      triggers: [],
      lua_scripts: [],
      at_actions: [],
      additional_assets: [],
      emotion_images: [],
      background_html: null,
      utility_bot: false,
      scriptstate_defaults: {},
      requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
    },
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    user_overrides: {},
    ...over,
  };
}

function storedRegex(over: Partial<StoredRegexScript> = {}): StoredRegexScript {
  return {
    name: 'rule',
    script_id: 'sid-1',
    find_regex: '/x/',
    replace_string: 'y',
    flags: 'g',
    placement: ['ai_output'],
    scope: 'character',
    scope_id: 'char-1',
    target: 'display',
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    run_on_edit: false,
    substitute_macros: 'none',
    disabled: false,
    sort_order: 0,
    description: '',
    folder: '',
    ...over,
  };
}

function moduleEnvelope(over: Partial<ModuleEnvelope> = {}): ModuleEnvelope {
  return {
    schema_version: MODULE_SCHEMA_VERSION,
    id: 'mod-A',
    filename: 'a.risum',
    uploaded_at: 100,
    module: {
      id: 'mod-A',
      name: 'Test Module',
      description: 'd',
    } as never,
    asset_index: {},
    ...over,
  };
}

// ─── Character path ─────────────────────────────────────────────────────

describe('buildCharacterViewerData — basic shape', () => {
  test('source carries kind=character + id + name', () => {
    const data = lumirealmFixture();
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'Reimu',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.source).toEqual({ kind: 'character', characterId: 'c1', name: 'Reimu' });
  });

  test('cjs is always null for characters', () => {
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(), worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.cjs).toBeNull();
  });

  test('ts defaults to current time when not provided; honoured when supplied', () => {
    const before = Date.now();
    const a = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(), worldBooks: [], extraCharacterRegex: [],
    });
    const after = Date.now();
    expect(a.ts).toBeGreaterThanOrEqual(before);
    expect(a.ts).toBeLessThanOrEqual(after);
    const b = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(), worldBooks: [], extraCharacterRegex: [],
      ts: 12345,
    });
    expect(b.ts).toBe(12345);
  });

  test('fetchWarnings pass through', () => {
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(), worldBooks: [], extraCharacterRegex: [],
      fetchWarnings: ['warn-1', 'warn-2'],
    });
    expect(out.fetchWarnings).toEqual(['warn-1', 'warn-2']);
  });
});

describe('buildCharacterViewerData — assets', () => {
  test('asset_index → ViewerAssetEntry[] with /api/v1/images URL (sorted by name)', () => {
    const data = lumirealmFixture({
      asset_index: {
        reimu: { imageIds: ['img-r'] },
        marisa: { imageIds: ['img-m'], ext: 'png' },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.assets.length).toBe(2);
    // Alphabetical sort: marisa < reimu.
    expect(out.assets[0]!.name).toBe('marisa');
    expect(out.assets[0]!.url).toBe('/api/v1/images/img-m');
    expect(out.assets[0]!.ext).toBe('png');
    expect(out.assets[1]!.name).toBe('reimu');
    expect(out.assets[1]!.url).toBe('/api/v1/images/img-r');
  });

  test('multi-source asset picks FIRST imageId + flags multi=true', () => {
    const data = lumirealmFixture({
      asset_index: {
        bg: { imageIds: ['img-A', 'img-B', 'img-C'] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.assets.length).toBe(1);
    expect(out.assets[0]!.url).toBe('/api/v1/images/img-A');
    expect(out.assets[0]!.multi).toBe(true);
  });

  test('single-source asset has multi=false', () => {
    const data = lumirealmFixture({
      asset_index: { single: { imageIds: ['img-only'] } },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.assets[0]!.multi).toBe(false);
  });

  test('asset with empty imageIds is skipped', () => {
    const data = lumirealmFixture({
      asset_index: {
        empty: { imageIds: [] },
        good: { imageIds: ['img-good'] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.assets.map((a) => a.name)).toEqual(['good']);
  });

  test('assets sorted alphabetically by name', () => {
    const data = lumirealmFixture({
      asset_index: {
        zebra: { imageIds: ['z'] },
        alpha: { imageIds: ['a'] },
        mango: { imageIds: ['m'] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.assets.map((a) => a.name)).toEqual(['alpha', 'mango', 'zebra']);
  });
});

describe('buildCharacterViewerData — triggers', () => {
  test('triggers + lua_scripts pair by index; trigger.comment becomes name', () => {
    const data = lumirealmFixture({
      payload: {
        triggers: [
          { type: 'manual', comment: 'Btn-A', effect: [{ type: 'triggerlua', code: 'lua-a' }] },
          { type: 'start', comment: 'Auto', effect: [{ type: 'v2SetVar', name: 'x', value: 1 }] },
        ],
        lua_scripts: ['lua-a', ''],
        at_actions: [],
        additional_assets: [],
        emotion_images: [],
        background_html: null,
        utility_bot: false,
        scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.triggers.length).toBe(2);
    expect(out.triggers[0]).toEqual({
      id: 'char-trig-0',
      name: 'Btn-A',
      bindingType: 'manual',
      lua: 'lua-a',
      effectCount: 1,
      effects: [],
    });
    expect(out.triggers[1]!.lua).toBeNull();
    expect(out.triggers[1]!.effectCount).toBe(1);
  });

  test('trigger without comment uses fallback "trigger #N"', () => {
    const data = lumirealmFixture({
      payload: {
        triggers: [{ type: 'manual', effect: [] }],
        lua_scripts: [''],
        at_actions: [],
        additional_assets: [],
        emotion_images: [],
        background_html: null,
        utility_bot: false,
        scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data, worldBooks: [], extraCharacterRegex: [],
    });
    expect(out.triggers[0]!.name).toBe('trigger #1');
  });
});

describe('buildCharacterViewerData — Lumi-managed surfaces are intentionally empty', () => {
  test('regex is ALWAYS empty for characters (Lumi UI handles it)', () => {
    const data = lumirealmFixture({
      regex_scripts: [
        storedRegex({ script_id: 'r-1', name: 'My Rule' }),
      ],
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data,
    });
    expect(out.regex).toEqual([]);
  });

  test('lorebook is populated from worldBooks (was empty pre-viewer-fix)', () => {
    const wb: FetchedWorldBook = {
      id: 'wb-1', name: 'Lore A',
      entries: [{ id: 'e-1', key: ['k'], content: 'c' }],
    };
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(),
      worldBooks: [wb],
    });
    expect(out.lorebook.length).toBe(1);
    expect(out.lorebook[0]!.groupName).toBe('Lore A');
    expect(out.lorebook[0]!.entries.length).toBe(1);
  });

  test('extraCharacterRegex is RESERVED — currently ignored', () => {
    const lumiRegex: LumiSideRegex = {
      id: 'lumi-id', name: 'X', find_regex: '/x/', replace_string: 'y',
    };
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(),
      extraCharacterRegex: [lumiRegex],
    });
    expect(out.regex).toEqual([]);
  });
});

describe('buildCharacterViewerData — backgroundHtml', () => {
  test('falls back to payload.background_html when no source / user edit', () => {
    const data = lumirealmFixture({
      payload: {
        triggers: [], lua_scripts: [], at_actions: [],
        additional_assets: [], emotion_images: [],
        background_html: '<style>body{background:red}</style>',
        utility_bot: false, scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C', data,
    });
    expect(out.backgroundHtml).toBe('<style>body{background:red}</style>');
  });

  test('prefers source.card raw over payload.background_html (pre-translate parity)', () => {
    const data = lumirealmFixture({
      source: {
        schema_version: 1,
        captured_at: 0,
        card: { data: { extensions: { risuai: { backgroundHTML: '{varname}' } } } },
        module: null,
        path_to_image_id: {},
      },
      payload: {
        triggers: [], lua_scripts: [], at_actions: [],
        additional_assets: [], emotion_images: [],
        background_html: '{{getvar::varname}}',
        utility_bot: false, scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C', data,
    });
    expect(out.backgroundHtml).toBe('{varname}');
  });

  test('user edit (background_html_source) wins outright over both', () => {
    const data = lumirealmFixture({
      source: {
        schema_version: 1,
        captured_at: 0,
        card: { data: { extensions: { risuai: { backgroundHTML: '<old/>' } } } },
        module: null,
        path_to_image_id: {},
      },
      payload: {
        triggers: [], lua_scripts: [], at_actions: [],
        additional_assets: [], emotion_images: [],
        background_html: '<translated/>',
        background_html_source: '<user-edit/>',
        utility_bot: false, scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C', data,
    });
    expect(out.backgroundHtml).toBe('<user-edit/>');
  });

  test('user-edit empty string clears (returns null)', () => {
    const data = lumirealmFixture({
      payload: {
        triggers: [], lua_scripts: [], at_actions: [],
        additional_assets: [], emotion_images: [],
        background_html: '<translated/>',
        background_html_source: '',
        utility_bot: false, scriptstate_defaults: {},
        requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      },
    });
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C', data,
    });
    expect(out.backgroundHtml).toBeNull();
  });

  test('null when payload.background_html is null and no other sources', () => {
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'C',
      data: lumirealmFixture(),
    });
    expect(out.backgroundHtml).toBeNull();
  });
});

// ─── Module path ────────────────────────────────────────────────────────

describe('buildModuleViewerData — basic shape', () => {
  test('source carries kind=module + envelope id + module name', () => {
    const env = moduleEnvelope({
      id: 'mod-Z',
      module: { id: 'mod-Z', name: 'Touhou Lightboard', description: '' } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.source).toEqual({ kind: 'module', moduleId: 'mod-Z', name: 'Touhou Lightboard' });
  });

  test('falls back to envelope id when module name is missing', () => {
    const env = moduleEnvelope({
      id: 'mod-fallback',
      module: { id: 'mod-fallback', description: '' } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.source.kind === 'module' && out.source.name).toBe('mod-fallback');
  });
});

describe('buildModuleViewerData — lorebook', () => {
  test('module.lorebook → single group named after the module', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        lorebook: [
          { key: ['k1'], content: 'c1' },
          { key: 'k2', content: 'c2' },
        ],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.lorebook.length).toBe(1);
    expect(out.lorebook[0]!.groupName).toBe('M');
    expect(out.lorebook[0]!.entries.length).toBe(2);
    expect(out.lorebook[0]!.entries[0]!.key).toEqual(['k1']);
    expect(out.lorebook[0]!.entries[1]!.key).toEqual(['k2']);
  });

  test('skips non-object lorebook entries', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        lorebook: [null, 'string', 42, { key: ['ok'], content: 'c' }],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.lorebook[0]!.entries.length).toBe(1);
  });

  test('empty lorebook → no group emitted at all', () => {
    const env = moduleEnvelope({
      module: { id: 'mod-A', name: 'M', description: '', lorebook: [] } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.lorebook).toEqual([]);
  });
});

describe('buildModuleViewerData — regex', () => {
  test('module.regex → ViewerRegexEntry tagged with envelope moduleId', () => {
    const env = moduleEnvelope({
      id: 'mod-X',
      module: {
        id: 'mod-X', name: 'M', description: '',
        regex: [
          { in: '/find/', out: 'replace', comment: 'r1', type: 'editdisplay' },
        ],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.regex.length).toBe(1);
    expect(out.regex[0]!.moduleId).toBe('mod-X');
    expect(out.regex[0]!.name).toBe('r1');
  });

  test('regex with empty `in` and empty comment is skipped', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        regex: [
          { in: '', out: 'x' },
          { in: '/y/', out: 'z' },
        ],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.regex.length).toBe(1);
    expect(out.regex[0]!.find).toBe('/y/');
  });

  test('regex with empty `in` but non-empty comment is preserved as a divider', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        regex: [
          { in: '/a/', out: 'b', comment: 'rule_a' },
          { in: '', out: '', comment: '---Future Plan---' },
          { in: '/c/', out: 'd', comment: 'rule_c' },
        ],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.regex.length).toBe(3);
    expect(out.regex[1]!.divider).toBe(true);
    expect(out.regex[1]!.name).toBe('---Future Plan---');
    expect(out.regex[1]!.find).toBe('');
    expect(out.regex[1]!.replace).toBe('');
  });

  test('disabled type flags disabled=true', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        regex: [{ in: '/x/', out: 'y', type: 'disabled' }],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.regex[0]!.disabled).toBe(true);
  });
});

describe('buildModuleViewerData — triggers', () => {
  test('triggerlua effect surfaces as lua field', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        trigger: [
          {
            type: 'manual', comment: 'Btn',
            effect: [{ type: 'triggerlua', code: 'print("hi")' }],
          },
        ],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.triggers.length).toBe(1);
    expect(out.triggers[0]!.lua).toBe('print("hi")');
    expect(out.triggers[0]!.bindingType).toBe('manual');
    expect(out.triggers[0]!.name).toBe('Btn');
  });

  test('multiple triggerlua effects concatenate', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        trigger: [{
          type: 'manual', comment: 'Btn',
          effect: [
            { type: 'triggerlua', code: 'a' },
            { type: 'v2SetVar' },
            { type: 'triggerlua', code: 'b' },
          ],
        }],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.triggers[0]!.lua).toBe('a\nb');
  });

  test('non-lua trigger has lua=null', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        trigger: [{ type: 'manual', effect: [{ type: 'v2SetVar' }] }],
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.triggers[0]!.lua).toBeNull();
  });
});

describe('buildModuleViewerData — assets', () => {
  test('envelope asset_index → ViewerAssetEntry[] with /api/v1/images URLs', () => {
    const env = moduleEnvelope({
      asset_index: {
        bg: { imageId: 'img-bg', ext: 'png' },
        sound: { imageId: 'img-snd' },
      },
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.assets.length).toBe(2);
    expect(out.assets[0]!.url).toContain('/api/v1/images/');
  });

  test('module assets all have multi=false (no multi-source per module)', () => {
    const env = moduleEnvelope({
      asset_index: { x: { imageId: 'img-x' } },
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.assets[0]!.multi).toBe(false);
  });

  test('assets sorted alphabetically', () => {
    const env = moduleEnvelope({
      asset_index: {
        zebra: { imageId: 'z' },
        alpha: { imageId: 'a' },
      },
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.assets.map((a) => a.name)).toEqual(['alpha', 'zebra']);
  });
});

describe('buildModuleViewerData — backgroundHtml is always null (modules don\'t have it)', () => {
  test('module without bg-html has backgroundHtml=null', () => {
    const env = moduleEnvelope();
    const out = buildModuleViewerData({ envelope: env });
    expect(out.backgroundHtml).toBeNull();
  });

  test('module with phantom bg-html field still has backgroundHtml=null (ignored)', () => {
    // Risu modules don't ship bg-html — even if a misshapen module
    // body had a `backgroundHTML` key, the module assembler ignores
    // it (character-only field).
    const env = moduleEnvelope({
      module: { id: 'mod-A', name: 'M', description: '', backgroundHTML: '<style>x</style>' } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.backgroundHtml).toBeNull();
  });
});

describe('buildModuleViewerData — cjs', () => {
  test('cjs string is preserved when present', () => {
    const env = moduleEnvelope({
      module: {
        id: 'mod-A', name: 'M', description: '',
        cjs: 'module.exports = {}',
      } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.cjs).toBe('module.exports = {}');
  });

  test('empty cjs string treated as null', () => {
    const env = moduleEnvelope({
      module: { id: 'mod-A', name: 'M', description: '', cjs: '' } as never,
    });
    const out = buildModuleViewerData({ envelope: env });
    expect(out.cjs).toBeNull();
  });

  test('missing cjs field is null', () => {
    const env = moduleEnvelope();
    const out = buildModuleViewerData({ envelope: env });
    expect(out.cjs).toBeNull();
  });
});

describe('buildCharacterViewerData — defaultVariablesText', () => {
  test('empty payload + no overrides → empty text + not user edited', () => {
    const out = buildCharacterViewerData({
      characterId: 'c-1',
      characterName: 'X',
      data: lumirealmFixture(),
    });
    expect(out.defaultVariablesText).toEqual('');
    expect(out.defaultVariablesUserEdited).toBe(false);
  });

  test('card defaults serialize sorted by name when no overrides', () => {
    const out = buildCharacterViewerData({
      characterId: 'c-1',
      characterName: 'X',
      data: lumirealmFixture({
        payload: {
          ...lumirealmFixture().payload,
          scriptstate_defaults: { mood: 'happy', day: '1' },
        },
      }),
    });
    expect(out.defaultVariablesText).toEqual('day=1\nmood=happy');
    expect(out.defaultVariablesUserEdited).toBe(false);
  });

  test('master text wins outright when set', () => {
    const out = buildCharacterViewerData({
      characterId: 'c-1',
      characterName: 'X',
      data: lumirealmFixture({
        payload: {
          ...lumirealmFixture().payload,
          scriptstate_defaults: { mood: 'happy' },
        },
        user_overrides: { default_variables_text: 'mood=sad\ncolor=red' },
      }),
    });
    expect(out.defaultVariablesText).toEqual('mood=sad\ncolor=red');
    expect(out.defaultVariablesUserEdited).toBe(true);
  });

  test('legacy per-key overrides round-trip into a sorted master string', () => {
    const out = buildCharacterViewerData({
      characterId: 'c-1',
      characterName: 'X',
      data: lumirealmFixture({
        payload: {
          ...lumirealmFixture().payload,
          scriptstate_defaults: { mood: 'happy' },
        },
        user_overrides: { default_variables_overrides: { mood: 'sad', user_added: 'value' } },
      }),
    });
    expect(out.defaultVariablesText).toEqual('mood=sad\nuser_added=value');
    expect(out.defaultVariablesUserEdited).toBe(true);
  });
});

describe('buildModuleViewerData — defaultVariablesText always empty', () => {
  test('module data has no scriptstate_defaults concept', () => {
    const env = moduleEnvelope();
    const out = buildModuleViewerData({ envelope: env });
    expect(out.defaultVariablesText).toEqual('');
    expect(out.defaultVariablesUserEdited).toBe(false);
  });
});

describe('buildCharacterViewerData — lorebook projection + sort', () => {
  function fwbEntry(over: Partial<{
    id: string;
    key: readonly string[];
    content: string;
    comment: string;
    disabled: boolean;
    constant: boolean;
    orderValue: number;
    extensions: Record<string, unknown> | null;
  }> = {}) {
    return {
      id: over.id ?? 'e1',
      key: over.key ?? ['k'],
      content: over.content ?? 'c',
      ...(over.comment !== undefined ? { comment: over.comment } : {}),
      ...(over.disabled !== undefined ? { disabled: over.disabled } : {}),
      ...(over.constant !== undefined ? { constant: over.constant } : {}),
      ...(over.orderValue !== undefined ? { orderValue: over.orderValue } : {}),
      extensions: over.extensions ?? null,
    };
  }

  test('returns one ViewerLorebookGroup per fetched world_book', () => {
    const wbs: FetchedWorldBook[] = [
      { id: 'wb-A', name: 'Book A', entries: [fwbEntry({ id: 'a1' })] },
      { id: 'wb-B', name: 'Book B', entries: [fwbEntry({ id: 'b1' })] },
    ];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    expect(out.lorebook.length).toBe(2);
    expect(out.lorebook[0]!.groupName).toBe('Book A');
    expect(out.lorebook[1]!.groupName).toBe('Book B');
  });

  test('skips empty world_books', () => {
    const wbs: FetchedWorldBook[] = [
      { id: 'wb-empty', name: 'Empty', entries: [] },
      { id: 'wb-full', name: 'Full', entries: [fwbEntry({ id: 'x' })] },
    ];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    expect(out.lorebook.length).toBe(1);
    expect(out.lorebook[0]!.groupName).toBe('Full');
  });

  test('sorts by _risu_array_index ASC (Risu authoring order)', () => {
    // Insertion order is intentionally scrambled so we know the sort fired.
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [
        fwbEntry({ id: 'idx5', extensions: { _risu_array_index: 5, _risu_source_hash: 'h5' } }),
        fwbEntry({ id: 'idx0', extensions: { _risu_array_index: 0, _risu_source_hash: 'h0' } }),
        fwbEntry({ id: 'idx2', extensions: { _risu_array_index: 2, _risu_source_hash: 'h2' } }),
      ],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    const ids = out.lorebook[0]!.entries.map((e) => e.id);
    expect(ids).toEqual(['idx0', 'idx2', 'idx5']);
  });

  test('user-added entries (no _risu_source_hash) sort to the end', () => {
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [
        fwbEntry({ id: 'user', extensions: { user: 1 } }),
        fwbEntry({ id: 'risu0', extensions: { _risu_array_index: 0, _risu_source_hash: 'h' } }),
        fwbEntry({ id: 'risu1', extensions: { _risu_array_index: 1, _risu_source_hash: 'h' } }),
      ],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    const ids = out.lorebook[0]!.entries.map((e) => e.id);
    expect(ids).toEqual(['risu0', 'risu1', 'user']);
  });

  test('fromRisu reflects _risu_source_hash presence', () => {
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [
        fwbEntry({ id: 'risu', extensions: { _risu_array_index: 0, _risu_source_hash: 'h' } }),
        fwbEntry({ id: 'user', extensions: {} }),
      ],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    const byId = new Map(out.lorebook[0]!.entries.map((e) => [e.id, e]));
    expect(byId.get('risu')!.fromRisu).toBe(true);
    expect(byId.get('user')!.fromRisu).toBe(false);
  });

  test('falls back to orderValue ASC for entries without arrayIndex', () => {
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [
        fwbEntry({ id: 'high', orderValue: 999, extensions: {} }),
        fwbEntry({ id: 'low', orderValue: 10, extensions: {} }),
      ],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    const ids = out.lorebook[0]!.entries.map((e) => e.id);
    expect(ids).toEqual(['low', 'high']);
  });

  test('surfaces translatedComment from translation map keyed by source-hash', () => {
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [
        fwbEntry({ id: 'k1', extensions: { _risu_source_hash: 'aaa', _risu_array_index: 0 } }),
        fwbEntry({ id: 'k2', extensions: { _risu_source_hash: 'bbb', _risu_array_index: 1 } }),
      ],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X',
      data: lumirealmFixture(),
      worldBooks: wbs,
      translatedCommentBySourceHash: new Map([['aaa', 'Translated 1']]),
    });
    const byId = new Map(out.lorebook[0]!.entries.map((e) => [e.id, e]));
    expect(byId.get('k1')!.translatedComment).toBe('Translated 1');
    expect(byId.get('k1')!.sourceHash).toBe('aaa');
    expect(byId.get('k2')!.translatedComment).toBeUndefined();
    expect(byId.get('k2')!.sourceHash).toBe('bbb');
  });

  test('omits translatedComment when no map provided', () => {
    const wbs: FetchedWorldBook[] = [{
      id: 'wb',
      name: 'B',
      entries: [fwbEntry({ id: 'k', extensions: { _risu_source_hash: 'h' } })],
    }];
    const out = buildCharacterViewerData({
      characterId: 'c1', characterName: 'X', data: lumirealmFixture(), worldBooks: wbs,
    });
    expect(out.lorebook[0]!.entries[0]!.translatedComment).toBeUndefined();
  });
});

