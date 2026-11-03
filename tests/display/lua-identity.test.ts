import { expect, test } from 'bun:test';
import { createDisplayResolver } from '../helpers/snapshot-display.js';
import { clearDisplaySnapshot, setDisplaySnapshot } from '../../src/display/snapshot.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { clearLuaEngines } from '../helpers/lua-bridge.js';
import { runtimeSnapshot } from '../helpers/runtime-snapshot.js';

// Risu's runScripted getters read char.name and char.firstMessage, independent of the selected greeting.
test.each([
  { name: 'Record name', firstMessage: 'Base greeting' },
  { name: '', firstMessage: '' },
])('display Lua reads the stored character identity: %j', async ({ name, firstMessage }) => {
  const chatId = 'lua-identity';
  const luaCode = `listenEdit('editDisplay', function(id, text)
    return getName(id) .. '|' .. getCharacterFirstMessage(id)
  end)`;
  const active = {
    ownerUserId: 'user', lumirealm: { user_overrides: {} },
    card: {
      character_id: 'character', asset_index: {}, emotion_index: {},
      risuPayload: {
        triggers: [{ type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }],
        lua_scripts: [luaCode], at_actions: [], scriptstate_defaults: {},
      },
    },
  } as unknown as ActiveCard;
  try {
    const snapshot = runtimeSnapshot(active, {
      revision: { epoch: 'host', sequence: 1 }, chat: { id: chatId, metadata: { activeGreetingIndex: 1 } },
      character: { id: 'character', name, nickname: 'Nickname', first_mes: firstMessage, alternate_greetings: ['Alternate greeting'], world_book_ids: [] },
      persona: { id: 'persona', name: 'User' }, lore: [], globalVariables: {}, messages: [
        { id: 'greeting', role: 'assistant', content: 'Edited selected greeting', index_in_chat: 0 },
        { id: 'message', role: 'user', content: 'Hello', index_in_chat: 1 },
      ],
    });
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
  }
});
