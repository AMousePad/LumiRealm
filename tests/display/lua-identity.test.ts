import { expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, setDisplaySnapshot } from '../../src/display/snapshot.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { clearLuaEngines } from '../../src/interpreter/lua-bridge.js';
import { assembleDisplaySnapshot } from '../../src/state/display-snapshot-assembly.js';

// Risu's runScripted getters read char.name and char.firstMessage, independent of the selected greeting.
test.each([
  { name: 'Record name', firstMessage: 'Base greeting' },
  { name: '', firstMessage: '' },
])('display Lua reads the stored character identity: %j', async ({ name, firstMessage }) => {
  const global = globalThis as unknown as { spindle?: unknown };
  const previous = global.spindle;
  const chatId = 'lua-identity';
  const luaCode = `listenEdit('editDisplay', function(id, text)
    return getName(id) .. '|' .. getCharacterFirstMessage(id)
  end)`;
  const active = {
    card: {
      character_id: 'character', asset_index: {}, emotion_index: {},
      risuPayload: {
        triggers: [{ type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }],
        lua_scripts: [luaCode], at_actions: [], scriptstate_defaults: {},
      },
    },
  } as unknown as ActiveCard;
  global.spindle = {
    characters: { get: async () => ({ name, nickname: 'Nickname', first_mes: firstMessage,
      alternate_greetings: ['Alternate greeting'], world_book_ids: [] }) },
    personas: { getActive: async () => ({ name: 'User' }) },
    chats: { get: async () => ({ metadata: { activeGreetingIndex: 1 } }) },
    chat: { getMessages: async () => [
      { id: 'greeting', role: 'assistant', content: 'Edited selected greeting' },
      { id: 'message', role: 'user', content: 'Hello' },
    ] },
  };
  try {
    const snapshot = await assembleDisplaySnapshot({
      modulesByNamespaceFromCard: () => ({}), legacyMediaFindings: () => false,
      getCompiledLibraries: () => [],
    }, active, chatId, 'user', { local: {}, global: {}, chat: {} });
    expect(snapshot.charName).toBe(name);
    expect(snapshot.character.firstMessage).toBe(firstMessage);
    expect(snapshot.character.selectedGreeting).toBe('Edited selected greeting');
    expect(snapshot.character.selectedAlternateGreetingIndex).toBe(0);
    setDisplaySnapshot(snapshot);
    const result = await createDisplayResolver().resolveBody({
      content: 'Hello',
      context: { chatId, characterId: 'character', messageId: 'message',
        messageIndex: 1, isUser: true, depth: 0 },
    });
    expect(result?.content).toBe(`${name}|${firstMessage}`);
  } finally {
    clearDisplaySnapshot(chatId);
    await clearLuaEngines();
    if (previous === undefined) delete global.spindle;
    else global.spindle = previous;
  }
});
