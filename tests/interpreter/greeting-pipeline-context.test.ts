import { afterEach, describe, expect, test } from 'bun:test';
import { buildBackendPipelineInput } from '../../src/interceptors/prompt-regex-apply.js';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { runtimeSnapshot } from '../helpers/runtime-snapshot.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { clearMessagesCache } from '../../src/interpreter/messages-cache.js';

const character = {
  id: 'char-1',
  name: 'Character',
  first_mes: 'Default greeting',
  alternate_greetings: ['Alternate one', 'Alternate two'],
  world_book_ids: [],
};

const messages = [
  {
    id: 'greeting',
    role: 'assistant',
    content: 'Edited alternate two',
    extra: { greeting: true, greeting_index: 2 },
  },
  {
    id: 'user',
    role: 'user',
    content: 'Hello',
  },
];

function installSpindle(canonicalIndex?: number): void {
  (globalThis as { spindle?: unknown }).spindle = {
    userStorage: { getJson: async () => null },
    chats: {
      get: async () => ({
        id: 'chat-1',
        metadata: canonicalIndex === undefined ? {} : { activeGreetingIndex: canonicalIndex },
      }),
    },
    characters: {
      get: async () => character,
    },
    personas: {
      getActive: async () => ({ name: 'User' }),
    },
    chat: {
      getMessages: async () => messages,
    },
  };
}

afterEach(() => {
  clearMessagesCache();
  delete (globalThis as { spindle?: unknown }).spindle;
});

function displaySnapshot(canonicalIndex: number) {
  const active = {
    ownerUserId: 'user-1', lumirealm: { user_overrides: {} }, card: {
      character_id: character.id, asset_index: {}, emotion_index: {},
      risuPayload: { triggers: [], lua_scripts: [], at_actions: [], scriptstate_defaults: {} },
    },
  } as unknown as ActiveCard;
  return runtimeSnapshot(active, {
    revision: { epoch: 'host', sequence: 1 }, chat: { id: 'chat-1', metadata: { activeGreetingIndex: canonicalIndex } },
    character, persona: { id: 'persona', name: 'User' },
    messages: messages.map((message, index_in_chat) => ({ ...message, index_in_chat })), lore: [], globalVariables: {},
  });
}

describe('selected greeting context', () => {
  test('prompt-regex context carries greeting identity and effective content', async () => {
    installSpindle(2);
    const prebuilt = await buildBackendPipelineInput(
      'chat-1',
      'char-1',
      'user-1',
      {
        activeCardByChat: new Map(),
        getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
        modulesByNamespaceFromCard: () => null,
        log: { info() {}, warn() {}, error() {}, debug() {} },
        errMsg: String,
      },
    );

    expect(runPipeline({
      ...prebuilt,
      template: '{{firstmsgindex}}|{{previouscharchat}}',
    })).toBe('1|Edited alternate two');
  });

  test('uses the persisted greeting-message index for existing chats', async () => {
    installSpindle(undefined);
    const prebuilt = await buildBackendPipelineInput(
      'chat-1',
      'char-1',
      'user-1',
      {
        activeCardByChat: new Map(),
        getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
        modulesByNamespaceFromCard: () => null,
        log: { info() {}, warn() {}, error() {}, debug() {} },
        errMsg: String,
      },
    );

    expect(runPipeline({
      ...prebuilt,
      template: '{{firstmsgindex}}',
    })).toBe('1');
  });

  test('frontend display snapshot carries the same greeting state', async () => {
    const snapshot = displaySnapshot(2);

    expect(snapshot.character.selectedAlternateGreetingIndex).toBe(1);
    expect(snapshot.character.selectedGreeting).toBe('Edited alternate two');
    expect(snapshot.character.alternateGreetings).toEqual([
      'Alternate one',
      'Alternate two',
    ]);
  });

  test('canonical default selection overrides stale greeting-message metadata', async () => {
    const snapshot = displaySnapshot(0);

    expect(snapshot.character.selectedAlternateGreetingIndex).toBe(-1);
  });
});
