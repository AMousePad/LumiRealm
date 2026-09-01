import { describe, expect, test } from 'bun:test';
import {
  createVariablesTogglesService,
  readCharacterToggleDsl,
} from '../../src/state/variables-toggles.js';
import { VariableStateStore } from '../../src/state/variables-state.js';
import { ToggleStateStore } from '../../src/state/toggle-state.js';
import type { LumirealmCharacterData } from '../../src/payload/types.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

function characterData(
  toggles: string | undefined,
  attachedModuleIds: readonly string[] = [],
): LumirealmCharacterData {
  return {
    schema_version: 1,
    imported_at: 1,
    extension_version: 'test',
    translator_version: 'test',
    source: {
      schema_version: 1,
      captured_at: 1,
      card: {
        spec: 'chara_card_v3',
        data: {
          extensions: {
            risuai: toggles === undefined ? {} : { toggles },
          },
        },
      },
      module: null,
      path_to_image_id: {},
    },
    payload: {
      triggers: [],
      lua_scripts: [],
      at_actions: [],
      additional_assets: [],
      emotion_images: [],
      background_html: null,
      utility_bot: false,
      scriptstate_defaults: {},
      requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    },
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    user_overrides: { attached_module_ids: attachedModuleIds },
  };
}

const noopLog = {
  info: () => {},
  warn: () => {},
  debug: () => {},
};

describe('character-owned Risu toggle DSL', () => {
  test('stored raw source wins, with the legacy risuai blob as fallback', () => {
    expect(
      readCharacterToggleDsl(
        characterData('source=Source label'),
        { toggles: 'legacy=Legacy label' },
      ),
    ).toBe('source=Source label');
    expect(
      readCharacterToggleDsl(
        characterData(undefined),
        { toggles: 'legacy=Legacy label' },
      ),
    ).toBe('legacy=Legacy label');
  });

  test('pushes character toggles even when no modules are attached', async () => {
    const sent: BackendToFrontend[] = [];
    let attachedReads = 0;
    const data = characterData('itemlist=Item list');
    const active = {
      chatId: 'chat-1',
      ownerUserId: 'user-1',
      characterWorldBookIds: [],
      lumirealm: data,
      card: {
        schema_version: 1,
        character_id: 'char-1',
        stored_at: 1,
        extension_version: 'test',
        risuPayload: {
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
          translator_version: 'test',
          risu_spec_version: 'test',
          requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
        },
        asset_index: {},
        emotion_index: {},
      },
    } as const;
    const service = createVariablesTogglesService({
      translateLang: 'en',
      variableState: new VariableStateStore(),
      toggleState: new ToggleStateStore(),
      readLumirealm: async () => ({
        data,
        risuai: {},
        character: { name: 'TestCard' },
      }),
      readAttachedModuleEnvelopes: async () => {
        attachedReads += 1;
        return [];
      },
      ensureActiveCardForChat: async () => active,
      refreshBgHtml: async () => {},
      send: (message) => sent.push(message),
      log: noopLog,
      errMsg: String,
    });

    await service.refreshToggleDefinitions(
      active,
      'chat-1',
      'user-1',
      { force: true },
    );

    expect(attachedReads).toBe(0);
    const message = sent.find(
      (item): item is Extract<BackendToFrontend, { type: 'set_toggle_definitions' }> =>
        item.type === 'set_toggle_definitions',
    );
    expect(message?.toggles).toEqual([
      expect.objectContaining({
        key: 'itemlist',
        value: 'Item list',
        moduleId: 'character:char-1',
      }),
    ]);
    expect(message?.attribution['itemlist']).toEqual({
      name: 'TestCard',
      moduleId: 'character:char-1',
    });
  });

  test('keeps Risu order: attached modules before character toggles', async () => {
    const sent: BackendToFrontend[] = [];
    const data = characterData('character=Character toggle', ['module-1']);
    const active = {
      chatId: 'chat-1',
      ownerUserId: 'user-1',
      characterWorldBookIds: [],
      lumirealm: data,
      card: {
        schema_version: 1,
        character_id: 'char-1',
        stored_at: 1,
        extension_version: 'test',
        risuPayload: {
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
          translator_version: 'test',
          risu_spec_version: 'test',
          requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
        },
        asset_index: {},
        emotion_index: {},
      },
    } as const;
    const service = createVariablesTogglesService({
      translateLang: 'en',
      variableState: new VariableStateStore(),
      toggleState: new ToggleStateStore(),
      readLumirealm: async () => ({
        data,
        risuai: {},
        character: { name: 'Card' },
      }),
      readAttachedModuleEnvelopes: async () => [{
        schema_version: 1,
        id: 'module-1',
        filename: 'module.risum',
        uploaded_at: 1,
        module: {
          name: 'Module',
          description: '',
          id: 'module-1',
          customModuleToggle: 'module=Module toggle',
        },
        asset_index: {},
      }],
      ensureActiveCardForChat: async () => active,
      refreshBgHtml: async () => {},
      send: (message) => sent.push(message),
      log: noopLog,
      errMsg: String,
    });

    await service.refreshToggleDefinitions(
      active,
      'chat-1',
      'user-1',
      { force: true },
    );

    const message = sent.find(
      (item): item is Extract<BackendToFrontend, { type: 'set_toggle_definitions' }> =>
        item.type === 'set_toggle_definitions',
    );
    expect(message?.toggles.map((toggle) => toggle.key)).toEqual([
      'module',
      'character',
    ]);
  });
});
