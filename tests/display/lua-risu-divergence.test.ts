import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { clearDisplaySnapshot, setDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import { type DisplayRuntimeEffect } from '../../src/display/host-shim.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';

// RisuAI e565563a: src/ts/process/scriptings.ts runScripted and runLuaEditTrigger.
// Strict mode makes these executable known failures red until their fixes land.
const divergence = process.env.RISU_PARITY_STRICT === '1' ? test : test.failing;
const chatId = 'lua-display-parity';
const context = {
  chatId, characterId: 'character', messageId: 'user-message',
  messageIndex: 1, isUser: true, depth: 0,
};

function snapshot(code: string): DisplaySnapshot {
  return {
    chatId, characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: 'Description', personality: '', scenario: '', exampleDialogue: '',
      mainPrompt: '', postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '',
      globalNote: '', authorsNote: '', firstMessage: 'Greeting', alternateGreetings: [],
      selectedAlternateGreetingIndex: -1, additionalAssets: {}, emotionImages: {},
      image: '', imageId: null,
    },
    chat: {
      messageCount: 2, lastMessage: 'Hello', lastUserMessage: 'Hello',
      lastCharMessage: 'Greeting', lastMessageId: 1,
      messages: [{ role: 'user', content: 'Hello', createdAt: 1700000000000 }],
    },
    vars: { local: { nested: '{{char}}', x: '2' }, global: {}, chat: {} },
    scriptstateDefaults: {}, screenWidth: 1280, screenHeight: 720,
    legacyMediaFindings: false, modulesByNamespace: {}, lorebook: [],
    hasEditDisplayLua: true, hasEditAtActions: false,
    luaTriggers: [{
      source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] },
      luaCode: code,
    }],
    messagesHost: [
      { id: 'greeting', role: 'assistant', content: 'Greeting' },
      { id: 'user-message', role: 'user', content: 'Hello', createdAt: 1700000000000 },
    ],
    lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}

beforeEach(() => setWasmoonEnabled(false));
afterEach(() => {
  clearDisplaySnapshot(chatId);
  setWasmoonEnabled(true);
});

async function render(code: string) {
  setDisplaySnapshot(snapshot(code));
  return createDisplayResolver().resolveBody({ content: 'Hello', context });
}

describe('Risu Lua frontend boundaries', () => {
  test('executes a listener and retains the bubble index in its metadata', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text, meta)
      return text .. '|' .. tostring(meta.index)
    end)`);
    expect(result?.content).toBe('Hello|0');
  });

  // Risu's getName and getCharacterFirstMessage read the current character without a safe-ID guard.
  divergence('identity getters retain the character name and greeting available in the snapshot', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text)
      return getName(id) .. '|' .. getCharacterFirstMessage(id)
    end)`);
    expect(result?.content).toBe('Character|Greeting');
  });

  // Risu grants editDisplay IDs variable writes, but setChat requires ScriptingSafeIds.
  divergence('display listeners cannot emit persisted message edits', async () => {
    const effects: DisplayRuntimeEffect[] = [];
    const snap = snapshot(`listenEdit('editDisplay', function(id, text)
      setChat(id, 0, 'Changed')
      return text
    end)`);
    const result = await runEditDisplayChain(snap, 'Hello', context, async text => text,
      () => {}, effect => { effects.push(effect); });
    expect({ result, effects }).toEqual({ result: 'Hello', effects: [] });
  });

  // Risu's cbs API invokes risuChatParser with only chara, leaving chatID at -1.
  divergence('Lua cbs keeps its default chat index separate from listener metadata', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text, meta)
      return tostring(meta.index) .. '|' .. cbs('{{chatindex}}')
    end)`);
    expect(result?.content).toBe('0|-1');
  });

  // Risu appends getvar output once; the Lua comparison observes it before the outer display parser runs.
  divergence('Lua cbs preserves macro text returned by a variable for that parser pass', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text)
      return tostring(cbs('{{getvar::nested}}') == '{{char}}')
    end)`);
    expect(result?.content).toBe('true');
  });

  test('display variable writes still produce a local delta and are readable in the same listener', async () => {
    const writes: Record<string, string>[] = [];
    const snap = snapshot(`listenEdit('editDisplay', function(id, text)
      setChatVar(id, 'x', '7')
      return getChatVar(id, 'x')
    end)`);
    const result = await runEditDisplayChain(snap, 'Hello', context, async text => text,
      vars => { writes.push(vars); });
    expect(result).toBe('7');
    expect(writes).toEqual([{ x: '7' }]);
  });
});
