import { afterEach, describe, expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import {
  clearDisplaySnapshot,
  setDisplaySnapshot,
  type DisplaySnapshot,
} from '../../src/display/snapshot.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';

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
      lastMessage: 'last',
      lastUserMessage: 'user',
      lastCharMessage: 'last',
      lastMessageId: 2,
      messages: [
        { role: 'user', content: 'user', createdAt: 0 },
        { role: 'assistant', content: 'last', createdAt: 0 },
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
    messagesHost: [],
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

afterEach(() => {
  clearDisplaySnapshot('chat-1');
  setWasmoonEnabled(true);
});

describe('frontend display resolver message context', () => {
  test('passes raw display content to Lua before the CBS parser pass', async () => {
    setWasmoonEnabled(false);
    setDisplaySnapshot(snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        if data == "{{user}}" then
          return data .. "|raw"
        end
        return data .. "|parsed"
      end)
    `));

    const result = await createDisplayResolver().resolveBody({
      content: '{{user}}',
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-2',
        messageIndex: 2,
        role: 'assistant',
      },
    });

    expect(result?.content).toBe('User|raw');
  });

  test('preloads frontend Lua global variables from the global scope', async () => {
    setWasmoonEnabled(false);
    const base = snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        return data .. "|" .. getGlobalVar(triggerId, "same")
      end)
    `);
    setDisplaySnapshot({
      ...base,
      vars: {
        ...base.vars,
        local: { same: 'local' },
        global: { same: 'global' },
      },
    });

    const result = await createDisplayResolver().resolveBody({
      content: 'value',
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-2',
        messageIndex: 2,
        role: 'assistant',
      },
    });

    expect(result?.content).toBe('value|global');
  });

  test('resolves find macros from the exact message, not chat-wide pre-resolution', async () => {
    setDisplaySnapshot(snapshot());
    const result = await createDisplayResolver().applyScripts({
      content: 'char',
      scripts: [{
        id: 'rule',
        find_regex: '{{role}}',
        replace_string: 'matched',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'escaped',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
      }],
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-2',
        messageIndex: 2,
        role: 'assistant',
        dynamicMacros: { chat_index: '2' },
      },
      resolvedFindPatterns: { rule: 'null' },
    });

    expect(result?.content).toBe('matched');
  });

  test('resolves replacement macros from the exact message, not chat-wide pre-resolution', async () => {
    setDisplaySnapshot(snapshot());
    const result = await createDisplayResolver().applyScripts({
      content: 'x',
      scripts: [{
        id: 'rule',
        find_regex: 'x',
        replace_string: '{{role}}:{{chat_index}}',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'escaped',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
      }],
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-2',
        messageIndex: 2,
        role: 'assistant',
        dynamicMacros: { chat_index: '2' },
      },
      resolvedReplacements: { rule: 'null:-1' },
    });

    expect(result?.content).toBe('char:1');
  });

  test('keeps chat_index absolute when the host index is relative to a paginated tail', async () => {
    setDisplaySnapshot(paginatedSnapshot());
    const result = await createDisplayResolver().applyScripts({
      content: 'x',
      scripts: [{
        id: 'rule',
        find_regex: 'x',
        replace_string: '{{chat_index}}|{{lastmessageid}}',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'after',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
      }],
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-32',
        messageIndex: 24,
        role: 'assistant',
        dynamicMacros: { chat_index: '24' },
      },
    });

    expect(result?.content).toBe('31|31');
  });

  test('applies native carry-forward replacement while preserving raw-match opt-out', async () => {
    const base = snapshot();
    setDisplaySnapshot({
      ...base,
      messagesHost: [
        { id: 'greeting', role: 'assistant', content: 'hello' },
        { id: 'message-1', role: 'assistant', content: 'old <status>ready</status>' },
        { id: 'message-2', role: 'assistant', content: 'new' },
      ],
    });
    const context = {
      chatId: 'chat-1',
      characterId: 'char-1',
      isUser: false,
      depth: 0,
      messageId: 'message-2',
      messageIndex: 2,
      role: 'assistant',
    } as const;
    const baseScript = {
      id: 'rule',
      find_regex: '<status>([^<]+)</status>',
      replace_string: '<strong>$1</strong>',
      flags: 'g',
      placement: ['ai_output'],
      substitute_macros: 'none' as const,
      trim_strings: [],
      min_depth: null,
      max_depth: null,
      disabled: false,
    };

    const replaced = await createDisplayResolver().applyScripts({
      content: 'new',
      scripts: [{
        ...baseScript,
        metadata: {
          match_actions: ['repeat_back'],
          repeat_position: 'end_nl',
        },
      }],
      context,
    });
    expect(replaced?.content).toBe('new\n<strong>ready</strong>');

    const raw = await createDisplayResolver().applyScripts({
      content: 'new',
      scripts: [{
        ...baseScript,
        metadata: {
          match_actions: ['repeat_back'],
          repeat_position: 'end_nl',
          repeat_raw_match: true,
        },
      }],
      context,
    });
    expect(raw?.content).toBe('new\n<status>ready</status>');
  });

  test('finds carry-forward history when the host index is relative to a paginated tail', async () => {
    const base = paginatedSnapshot();
    const messagesHost = base.messagesHost.map((message) =>
      message.id === 'message-30'
        ? { ...message, content: 'old <status>ready</status>' }
        : message
    );
    setDisplaySnapshot({ ...base, messagesHost });

    const result = await createDisplayResolver().applyScripts({
      content: 'new',
      scripts: [{
        id: 'rule',
        find_regex: '<status>([^<]+)</status>',
        replace_string: '<strong>$1</strong>',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'none',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
        metadata: {
          match_actions: ['repeat_back'],
          repeat_position: 'end_nl',
        },
      }],
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageIndex: 24,
        role: 'assistant',
      },
    });

    expect(result?.content).toBe('new\n<strong>ready</strong>');
  });

  test('runs a module expression action only in its exact live host slot', async () => {
    const base = snapshot();
    setDisplaySnapshot({
      ...base,
      character: {
        ...base.character,
        emotionImages: { Joy: { imageIds: ['joy-image'] } },
      },
      atActions: [{
        action: 'emo',
        directAction: 'emo',
        findRegex: 'old',
        flag: 'g',
        out: '@@emo Old',
        phase: 'editdisplay',
        order: 0,
        sourceIndex: 0,
        sourceRowIndex: 0,
        sourceOrigin: 'module:module-a',
        liveScriptId: 'row-a',
      }],
    });
    const effects: unknown[] = [];
    const resolver = createDisplayResolver(
      undefined,
      (effect) => { effects.push(effect); },
    );
    const context = {
      chatId: 'chat-1',
      characterId: 'char-1',
      isUser: false,
      depth: 0,
      messageId: 'message-2',
      messageIndex: 2,
      role: 'assistant',
    } as const;

    await resolver.resolveBody({ content: 'happy', context });
    expect(effects).toEqual([]);

    await resolver.applyScripts({
      content: 'happy',
      scripts: [{
        id: 'row-a',
        find_regex: 'happy',
        replace_string: '@@emo Joy',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'none',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
        metadata: {
          _risu: {
            module_id: 'module-a',
            phase: 'editdisplay',
            source_index: 0,
            source_row_index: 0,
          },
        },
      }],
      context,
    });

    expect(effects).toEqual([{
      kind: 'set-expression',
      chatId: 'chat-1',
      characterId: 'char-1',
      label: 'Joy',
      imageId: 'joy-image',
    }]);
  });

  test('persists module inject through a frontend effect without a worker call', async () => {
    const base = snapshot();
    setDisplaySnapshot({
      ...base,
      messagesHost: [
        { id: 'greeting', role: 'assistant', content: 'hello' },
        { id: 'message-1', role: 'assistant', content: 'raw' },
      ],
      atActions: [{
        action: 'inject',
        directAction: 'inject',
        findRegex: 'old',
        flag: 'g',
        out: '@@inject',
        phase: 'editdisplay',
        order: 0,
        sourceIndex: 0,
        sourceRowIndex: 0,
        sourceOrigin: 'module:module-a',
        liveScriptId: 'row-a',
      }],
    });
    const effects: unknown[] = [];
    const result = await createDisplayResolver(
      undefined,
      (effect) => { effects.push(effect); },
    ).applyScripts({
      content: 'STATE visible',
      scripts: [{
        id: 'row-a',
        find_regex: 'STATE ',
        replace_string: '@@inject',
        flags: 'g',
        placement: ['ai_output'],
        substitute_macros: 'none',
        trim_strings: [],
        min_depth: null,
        max_depth: null,
        disabled: false,
        metadata: {
          _risu: {
            module_id: 'module-a',
            phase: 'editdisplay',
            source_index: 0,
            source_row_index: 0,
          },
        },
      }],
      context: {
        chatId: 'chat-1',
        characterId: 'char-1',
        isUser: false,
        depth: 0,
        messageId: 'message-1',
        messageIndex: 1,
        role: 'assistant',
      },
    });

    expect(result?.content).toBe('visible');
    expect(effects).toEqual([{
      kind: 'edit-message',
      chatId: 'chat-1',
      messageId: 'message-1',
      content: 'STATE visible',
    }]);
    expect(result?.cacheable).toBe(false);
  });
});
