import { describe, expect, mock, test } from 'bun:test';
import { dirname, join } from 'node:path';
import type { DisplaySnapshot } from '../../src/display/snapshot.js';
import { withCurrentDisplayMessage } from '../../src/display/host-shim.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

// Bun routes emscripten wasm loading through fs, where the inlined data URI
// is not an openable path, so feed the factory the on-disk wasmoon glue.
mock.module('../../src/display/_glue-wasm-b64.js', () => ({
  GLUE_WASM_DATA_URI: join(dirname(Bun.resolveSync('wasmoon', import.meta.dir)), 'glue.wasm'),
}));

function snapshot(luaCode = ''): DisplaySnapshot {
  return {
    chatId: 'chat-1',
    characterId: 'char-1',
    userName: 'User',
    charName: 'Character',
    personaText: '',
    personaImage: '',
    personaImageId: null,
    chatAuthorsNote: null,
    character: {
      description: '',
      personality: '',
      scenario: '',
      exampleDialogue: '',
      mainPrompt: '',
      postHistoryInstructions: '',
      creatorNotes: '',
      jailbreakPrompt: '',
      globalNote: '',
      authorsNote: '',
      firstMessage: '',
      alternateGreetings: [],
      selectedAlternateGreetingIndex: -1,
      additionalAssets: {},
      emotionImages: {},
      image: '',
      imageId: null,
    },
    chat: {
      messageCount: 3,
      lastMessage: 'stale assistant text',
      lastUserMessage: 'hello',
      lastCharMessage: 'stale assistant text',
      lastMessageId: 2,
      messages: [
        { role: 'user', content: 'hello', createdAt: 0 },
        { role: 'assistant', content: 'stale assistant text', createdAt: 0 },
      ],
    },
    vars: { local: {}, global: {}, chat: {} },
    scriptstateDefaults: {},
    screenWidth: 1920,
    screenHeight: 1080,
    legacyMediaFindings: false,
    modulesByNamespace: {},
    lorebook: [],
    hasEditDisplayLua: luaCode.length > 0,
    hasEditAtActions: false,
    luaTriggers: luaCode.length > 0
      ? [{ source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }, luaCode }]
      : [],
    messagesHost: [
      { id: 'older', role: 'user', content: 'hello' },
      { id: 'latest', role: 'assistant', content: 'stale assistant text' },
    ],
    lorebookHost: [],
    atActions: [],
    compiledLibraries: [],
  };
}

function paginatedSnapshot(luaCode = ''): DisplaySnapshot {
  const base = snapshot(luaCode);
  const messages = Array.from({ length: 32 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `message ${index + 1}`,
    createdAt: index + 1,
  }));
  return {
    ...base,
    chat: {
      messageCount: 33,
      lastMessage: 'message 32',
      lastUserMessage: 'message 31',
      lastCharMessage: 'message 32',
      lastMessageId: 32,
      messages,
    },
    messagesHost: [
      { id: 'greeting', role: 'assistant', content: 'Greeting' },
      ...messages.map((message, index) => ({
        id: `message-${index + 1}`,
        role: message.role,
        content: message.content,
      })),
    ],
  };
}

describe('frontend display current-message view', () => {
  test('overlays an edited bubble into getFullChat data without mutating the pushed snapshot', () => {
    const pushed = snapshot();
    const live = withCurrentDisplayMessage(
      pushed,
      {
        chatId: 'chat-1',
        isUser: false,
        depth: 0,
        messageId: 'latest',
        messageIndex: 2,
        role: 'assistant',
      },
      '<Inventory><Item id="oak_log" count="64"></Inventory>',
    );

    expect(live).not.toBe(pushed);
    expect(live.messagesHost[1]?.content).toBe(
      '<Inventory><Item id="oak_log" count="64"></Inventory>',
    );
    expect(pushed.messagesHost[1]?.content).toBe('stale assistant text');
  });

  test('does not guess when the host did not identify the rendered message', () => {
    const pushed = snapshot();
    expect(withCurrentDisplayMessage(
      pushed,
      { chatId: 'chat-1', isUser: false, depth: 0 },
      'new',
    )).toBe(pushed);
    expect(withCurrentDisplayMessage(
      pushed,
      {
        chatId: 'chat-1',
        isUser: false,
        depth: 0,
        messageId: 'missing',
        messageIndex: 5,
      },
      'new',
    )).toBe(pushed);
  });

  test('reuses the snapshot when its message row is already current', () => {
    const pushed = snapshot();
    expect(
      withCurrentDisplayMessage(
        pushed,
        {
          chatId: 'chat-1',
          isUser: false,
          depth: 0,
          messageId: 'latest',
          messageIndex: 2,
          role: 'assistant',
        },
        'stale assistant text',
      ),
    ).toBe(pushed);
  });

  test('appends a newly rendered assistant at the exact host message index', () => {
    const pushed = snapshot();
    const live = withCurrentDisplayMessage(
      pushed,
      {
        chatId: 'chat-1',
        isUser: false,
        depth: 0,
        messageId: 'streaming',
        messageIndex: 2,
        role: 'assistant',
      },
      'streaming assistant text',
    );

    expect(live.messagesHost[2]).toEqual({
      id: 'streaming',
      role: 'assistant',
      content: 'streaming assistant text',
    });
  });

  test('passes the absolute full-history index to paginated editDisplay Lua', async () => {
    const pushed = paginatedSnapshot(`
      listenEdit("editDisplay", function(triggerId, data, meta)
        return data .. "|" .. tostring(meta.index)
      end)
    `);

    setWasmoonEnabled(false);
    try {
      const rendered = await runEditDisplayChain(
        pushed,
        'value',
        {
          chatId: 'chat-1',
          characterId: 'char-1',
          isUser: false,
          depth: 0,
          messageId: 'message-32',
          messageIndex: 24,
          role: 'assistant',
          dynamicMacros: { chat_index: '24' },
        },
        async (value) => value,
        () => {},
      );

      expect(rendered).toBe('value|31');
    } finally {
      setWasmoonEnabled(true);
    }
  });

  test('keeps getFullChat raw when editDisplay receives CBS-resolved content', async () => {
    const raw = '{{char}} inventory';
    const pushed = snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        local chats = getFullChat(triggerId)
        return chats[#chats].data .. "|" .. data
      end)
    `);
    const live = withCurrentDisplayMessage(
      pushed,
      {
        chatId: 'chat-1',
        isUser: false,
        depth: 0,
        messageId: 'latest',
        messageIndex: 2,
        role: 'assistant',
      },
      raw,
    );

    setWasmoonEnabled(false);
    try {
      const rendered = await runEditDisplayChain(
        live,
        'Character inventory',
        {
          chatId: 'chat-1',
          characterId: 'char-1',
          isUser: false,
          depth: 0,
          messageId: 'latest',
          messageIndex: 2,
          role: 'assistant',
        },
        async (value) => value,
        () => {},
      );
      expect(rendered).toBe(`${raw}|Character inventory`);
    } finally {
      setWasmoonEnabled(true);
    }
  });

  test('craft-card-style editDisplay sees an edited last assistant as live immediately', async () => {
    const pushed = snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        local chats = getFullChat(triggerId)
        local is_last = #chats ~= 0 and chats[#chats].data == data
        local is_char = false
        for _, chat in ipairs(chats) do
          if chat.data == data then
            is_char = chat.role == "char"
          end
        end
        if is_last and is_char then
          return data .. "<crafting-controls>"
        end
        return data .. "<bare-inventory>"
      end)
    `);
    const edited =
      '<Inventory><Item id="oak_log" count="64"></Inventory>';

    // Bun cannot load wasmoon's browser-targeted wasm URL directly. The
    // snapshot bridge is engine-independent, so exercise it through the
    // production fengari fallback.
    setWasmoonEnabled(false);
    try {
      const live = withCurrentDisplayMessage(
        pushed,
        {
          chatId: 'chat-1',
          isUser: false,
          depth: 0,
          messageId: 'latest',
          messageIndex: 2,
          role: 'assistant',
        },
        edited,
      );
      const rendered = await runEditDisplayChain(
        live,
        edited,
        {
          chatId: 'chat-1',
          characterId: 'char-1',
          isUser: false,
          depth: 0,
          messageId: 'latest',
          role: 'assistant',
        },
        async (value) => value,
        () => {},
      );

      expect(rendered).toBe(`${edited}<crafting-controls>`);
    } finally {
      setWasmoonEnabled(true);
    }
  });

  test('craft-card-style editDisplay sees an edited last assistant through wasmoon', async () => {
    const pushed = snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        local chats = getFullChat(triggerId)
        local last_data = #chats ~= 0 and chats[#chats].data or "<none>"
        local last_role = #chats ~= 0 and chats[#chats].role or "<none>"
        return data .. "|n=" .. #chats .. "|last=" .. last_data .. "|role=" .. last_role
      end)
    `);
    const edited =
      '<Inventory><Item id="oak_log" count="64"></Inventory>';

    setWasmoonEnabled(true);
    const live = withCurrentDisplayMessage(
      pushed,
      {
        chatId: 'chat-1',
        isUser: false,
        depth: 0,
        messageId: 'latest',
        messageIndex: 2,
        role: 'assistant',
      },
      edited,
    );
    const rendered = await runEditDisplayChain(
      live,
      edited,
      {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'latest',
        role: 'assistant',
      },
      async (value) => value,
      () => {},
    );

    expect(rendered).toBe(
      `${edited}|n=2|last=${edited}|role=char`,
    );
  });

  test('Wasmoon preserves same-source state but recreates the mode engine when source changes', async () => {
    clearWasmoonEngine('editDisplay');
    setWasmoonEnabled(true);
    const codeA = `
      counter = counter or 0
      listenEdit("editDisplay", function(triggerId, data)
        counter = counter + 1
        return data .. "|A" .. counter
      end)
    `;
    const codeB = `
      listenEdit("editDisplay", function(triggerId, data)
        return data .. "|B|" .. tostring(counter or "clean")
      end)
    `;
    const first = snapshot(codeA);
    const second = { ...snapshot(codeB), characterId: 'char-2' };
    const context = {
      chatId: 'chat-1',
      characterId: 'char-1',
      isUser: false,
      depth: 0,
      role: 'assistant',
    } as const;
    const run = (snap: DisplaySnapshot, value: string) => runEditDisplayChain(
      snap,
      value,
      { ...context, characterId: snap.characterId },
      async (template) => template,
      () => {},
    );

    expect(await run(first, 'x')).toBe('x|A1');
    expect(await run(first, 'x')).toBe('x|A2');
    expect(await run(second, 'x')).toBe('x|B|clean');
    expect(await run(first, 'x')).toBe('x|A1');

    clearWasmoonEngine('editDisplay');
  });
});
