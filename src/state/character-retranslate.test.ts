import { describe, expect, test } from 'bun:test';

import { CURRENT_CHARACTER_SCHEMA_VERSION } from '../migrations/character.js';
import type { LumirealmCharacterData, StoredRegexScript } from '../payload/types.js';
import {
  retranslateCharacterFromCurrentSource,
  type CharacterRetranslateDeps,
} from './character-retranslate.js';

const sourceCard = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Current Pipeline Card',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {
      risuai: {
        backgroundHTML: '<div>source background</div>',
        customScripts: [],
      },
    },
  },
};

function envelope(): LumirealmCharacterData {
  return {
    schema_version: 1,
    imported_at: 1_700_000_000_000,
    extension_version: 'old-extension',
    translator_version: 'old-translator',
    translator_schema_version: CURRENT_CHARACTER_SCHEMA_VERSION,
    display_owner: true,
    source: {
      schema_version: 1,
      captured_at: 1_700_000_000_000,
      card: sourceCard,
      module: null,
      path_to_image_id: {},
    },
    payload: {
      triggers: ['stale'],
      lua_scripts: ['stale'],
      at_actions: ['stale'],
      additional_assets: [],
      emotion_images: [],
      background_html: '<div>stale runtime</div>',
      background_html_source: '<section>user-authored background</section>',
      utility_bot: false,
      scriptstate_defaults: { stale: '1' },
      requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    },
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    user_overrides: {
      attached_module_ids: ['module-1'],
      default_variables_overrides: { kept: 'yes' },
    },
    translations: { ko: { name: '현재' } },
  };
}

function deps(overrides: Partial<CharacterRetranslateDeps> = {}): CharacterRetranslateDeps {
  return {
    extensionVersion: 'new-extension',
    getAvatarImageId: async () => null,
    installCharacterRegexScripts: async () => {},
    writeEnvelope: async () => {},
    dispatchSvgRasterize: () => {},
    invalidateActiveForCharacter: () => {},
    log: { info: () => {}, warn: () => {} },
    ...overrides,
  };
}

describe('current character re-translation', () => {
  test('runs the current translator directly and preserves identity-owned state', async () => {
    const input = envelope();
    const events: string[] = [];
    let written: LumirealmCharacterData | null = null;
    let installed: readonly StoredRegexScript[] | null = null;

    const result = await retranslateCharacterFromCurrentSource(
      {
        characterId: 'char-1',
        characterName: 'Current Pipeline Card',
        userId: 'user-1',
        envelope: input,
      },
      deps({
        installCharacterRegexScripts: async (_id, _name, scripts) => {
          events.push('install');
          installed = scripts;
        },
        writeEnvelope: async (_id, data) => {
          events.push('write');
          written = data;
        },
        invalidateActiveForCharacter: () => { events.push('invalidate'); },
      }),
    );

    expect(result.kind).toBe('retranslated');
    expect(events).toEqual(['install', 'write', 'invalidate']);
    expect(installed).not.toBeNull();
    expect(written).not.toBeNull();
    expect(written!.translator_schema_version).toBe(CURRENT_CHARACTER_SCHEMA_VERSION);
    expect(written!.extension_version).toBe('new-extension');
    expect(written!.imported_at).toBe(input.imported_at);
    expect(written!.source).toEqual(input.source);
    expect(written!.user_overrides).toEqual(input.user_overrides);
    expect(written!.translations).toEqual(input.translations);
    expect(written!.display_owner).toBe(true);
    expect(written!.payload.background_html_source)
      .toBe('<section>user-authored background</section>');
    expect(written!.payload.background_html)
      .toContain('user-authored background');
    expect(input.translator_schema_version).toBe(CURRENT_CHARACTER_SCHEMA_VERSION);
  });

  test('does not write or alter the schema version when current projection install fails', async () => {
    const base = envelope();
    const cardWithInlineAsset = {
      ...structuredClone(sourceCard),
      data: {
        ...structuredClone(sourceCard.data),
        assets: [{
          type: 'x-risu-asset',
          name: 'inline',
          uri: 'data:image/png;base64,iVBORw0KGgo=',
          ext: 'png',
        }],
      },
    };
    const input = {
      ...base,
      source: { ...base.source!, card: cardWithInlineAsset },
    };
    const sourceBefore = structuredClone(input.source);
    let writes = 0;
    let invalidations = 0;
    const result = await retranslateCharacterFromCurrentSource(
      {
        characterId: 'char-1',
        characterName: 'Current Pipeline Card',
        userId: 'user-1',
        envelope: input,
      },
      deps({
        installCharacterRegexScripts: async () => { throw new Error('install failed'); },
        writeEnvelope: async () => { writes++; },
        invalidateActiveForCharacter: () => { invalidations++; },
      }),
    );

    expect(result).toEqual({ kind: 'failed', error: 'install failed' });
    expect(writes).toBe(0);
    expect(invalidations).toBe(0);
    expect(input.translator_schema_version).toBe(CURRENT_CHARACTER_SCHEMA_VERSION);
    expect(input.source).toEqual(sourceBefore);
  });

  test('requires captured source instead of falling back to migrations', async () => {
    const input = { ...envelope(), source: undefined } as unknown as LumirealmCharacterData;
    let installs = 0;
    const result = await retranslateCharacterFromCurrentSource(
      {
        characterId: 'legacy',
        characterName: 'Legacy',
        userId: 'user-1',
        envelope: input,
      },
      deps({ installCharacterRegexScripts: async () => { installs++; } }),
    );

    expect(result).toEqual({ kind: 'needs_reimport' });
    expect(installs).toBe(0);
  });
});
