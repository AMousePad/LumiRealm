import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, setDisplaySnapshot } from '../../src/display/snapshot.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';

import type { DisplaySnapshot } from '../../src/display/snapshot.js';

const code = `
listenEdit("editDisplay", function(id, data, meta)
  return table.concat({
    tostring(meta.index), cbs("{{chatindex}}"), cbs("{{role}}"), cbs("{{isfirstmsg}}"),
    tostring(cbs("{{lastusermessage}}|{{lastcharmessage}}") == "|Assistant3"),
    tostring(cbs("{{SET_VAR:x:9}}") == "{{SET_VAR:x:9}}"),
    tostring(cbs("{{addvar::x::1}}") == "{{addvar::x::1}}"),
    tostring(cbs("{{setdefaultvar::x::9}}") == "{{setdefaultvar::x::9}}"),
    getChatVar(id, "x"),
    tostring(cbs("{{getvar::nested}}") == "{{char}}"),
    tostring(cbs("{{getvar::{{getvar::key}}}}") == "{{char}}"),
    tostring(cbs(cbs("{{getvar::nested}}")) == "Character"),
    tostring(cbs("{{description}}") == "Character"),
    tostring(cbs("{{settempvar::scratch::one}}{{tempvar::scratch}}") == "one"),
    tostring(cbs("{{tempvar::scratch}}") == "")
  }, "|")
end)
`;

function snapshot(luaCode = code): DisplaySnapshot {
  const messages = [
    { role: 'user' as const, content: 'User0', createdAt: 1000 },
    { role: 'assistant' as const, content: 'Assistant1', createdAt: 2000 },
    { role: 'user' as const, content: 'User2', createdAt: 3000 },
    { role: 'assistant' as const, content: 'Assistant3', createdAt: 4000 },
  ];
  return {
    chatId: 'lua-cbs-context', characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: '{{char}}', personality: '', scenario: '', exampleDialogue: '', mainPrompt: '',
      postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '', globalNote: '', authorsNote: '',
      firstMessage: 'Greeting', alternateGreetings: [], selectedAlternateGreetingIndex: -1,
      additionalAssets: {}, emotionImages: {}, image: '', imageId: null,
    },
    chat: { messageCount: 5, lastMessage: 'Assistant3', lastUserMessage: 'User2', lastCharMessage: 'Assistant3', lastMessageId: 4, messages },
    vars: { local: { x: '2', nested: '{{char}}', key: 'nested' }, global: {}, chat: {} },
    scriptstateDefaults: {}, screenWidth: 1280, screenHeight: 720, legacyMediaFindings: false,
    modulesByNamespace: {}, lorebook: [], hasEditDisplayLua: true, hasEditAtActions: false,
    luaTriggers: [{ source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }, luaCode }],
    messagesHost: [{ id: 'greeting', role: 'assistant', content: 'Greeting' }, ...messages.map((message, index) => ({ id: `message-${index}`, ...message }))],
    lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}

function context(index: number) {
  return {
    chatId: 'lua-cbs-context', characterId: 'character', isUser: index >= 0 && index % 2 === 0,
    depth: 3 - index, messageId: index === -1 ? 'greeting' : `message-${index}`, messageIndex: index + 1,
    role: index >= 0 && index % 2 === 0 ? 'user' : 'assistant',
  };
}


afterEach(() => {
  clearDisplaySnapshot('lua-cbs-context');
  setWasmoonEnabled(true);
});

describe('frontend Lua cbs uses Risu parser defaults', () => {
  test.each([-1, 0, 1, 3])('keeps listener index %s separate from cbs context', async index => {
    setWasmoonEnabled(false);
    const snap = snapshot();
    setDisplaySnapshot(snap);
    const network = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    const writes: unknown[] = [];
    try {
      const result = await createDisplayResolver((chatId, vars) => { writes.push({ chatId, vars }); }).resolveBody({
        content: index === -1 ? 'Greeting' : snap.chat.messages[index]!.content,
        context: context(index),
      });
      expect(result?.content).toBe(index + '|-1|null|0|true|true|true|true|2|true|true|true|true|true|true');
      for (const name of ['x', 'nested', 'key']) expect(result?.touchedVars).toContain('local:' + name);
      expect(result?.cacheable).toBe(true);
      expect(writes).toEqual([]);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
