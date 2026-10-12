import { afterEach, expect, test } from 'bun:test';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly.js';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import { runtimeDisplaySnapshot } from '../../src/frontend-lua/snapshot.js';
import { clearScreenDims, setScreenDims } from '../../src/interpreter/screen-dims-cache.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { snapshot } from '../helpers/display-lua-fixture.js';

afterEach(() => clearScreenDims('config-owner'));

test('configuration needs no host reads and preserves the display assembled from revisioned state', () => {
  const previous = snapshot('function onStart() end');
  setScreenDims('config-owner', { width: previous.screenWidth, height: previous.screenHeight });
  const active = { card: {
    character_id: previous.characterId, asset_index: previous.character.additionalAssets,
    emotion_index: previous.character.emotionImages,
    risuPayload: {
      triggers: previous.luaTriggers.map(entry => entry.source),
      lua_scripts: previous.luaTriggers.map(entry => entry.luaCode), at_actions: previous.atActions,
      scriptstate_defaults: previous.scriptstateDefaults,
    },
  } } as unknown as ActiveCard;
  const config = assembleRuntimeConfig({
    modulesByNamespaceFromCard: () => previous.modulesByNamespace,
    legacyMediaFindings: () => previous.legacyMediaFindings,
    getCompiledLibraries: () => previous.compiledLibraries,
  }, active, previous.chatId, 'config-owner');
  for (const key of ['messagesHost', 'chat', 'vars', 'lorebook', 'lorebookHost', 'charName', 'personaText']) {
    expect(config).not.toHaveProperty(key);
  }
  const state = new FrontendRuntimeState({
    revision: { epoch: 'host', sequence: 9 },
    chat: { id: previous.chatId, metadata: { chat_variables: { current: 'yes' }, macro_variables: { global: { currentGlobal: 'yes' } }, activeGreetingIndex: 1,
      authors_note: { content: 'Current note', depth: 3 } } },
    character: { id: previous.characterId, name: 'Live character', description: 'Live description',
      image_id: 'portrait', first_mes: 'First', alternate_greetings: ['Alternate'], personality: 'Live personality' },
    persona: { id: 'persona', name: 'Live user', description: 'Live persona', image_id: 'avatar' },
    messages: [{ id: 'greeting', content: 'Selected greeting', role: 'assistant', index_in_chat: 0,
      extra: { greeting_index: 1 } }, { id: 'message', content: 'Current message', role: 'user', index_in_chat: 4 }],
    lore: [{ id: 'lore', world_book_id: 'book', content: 'Live lore', order_value: 3 }],
    globalVariables: { currentGlobal: 'yes' },
  }, async () => { throw new Error('Unexpected state write'); }, () => {});
  const value = runtimeDisplaySnapshot(config, state);
  expect(value).toEqual(runtimeDisplaySnapshot(previous, state));
  expect(value.character.additionalAssets).toBe(previous.character.additionalAssets);
  expect(value).toMatchObject({ charName: 'Live character', userName: 'Live user',
    personaText: 'Live persona', chatAuthorsNote: { content: 'Current note', depth: 3 },
    vars: { local: { current: 'yes' }, global: { currentGlobal: 'yes' } },
  });
});
