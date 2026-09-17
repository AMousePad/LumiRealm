import { afterEach, describe, expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import {
  clearDisplaySnapshot,
  setDisplaySnapshot,
  type DisplaySnapshot,
} from '../../src/display/snapshot.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';

function displayRule(overrides: Partial<FeRegexScript> = {}): FeRegexScript {
  return {
    id: 'rule', find_regex: 'TOKEN', replace_string: '{{char}}', flags: 'g',
    placement: ['ai_output'], substitute_macros: 'none', trim_strings: [],
    min_depth: null, max_depth: null, ...overrides,
  };
}

async function applyRules(scripts: readonly FeRegexScript[], content = 'TOKEN') {
  return createDisplayResolver().applyScripts({
    content, scripts: [...scripts],
    context: { chatId: 'chat-1', characterId: 'char-1', isUser: false, depth: 0 },
  });
}

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
  test.each([
    'Narration with **bold** and *italics*.',
    '```html\n</div>\n```',
    '<div class="scene"><section>Unfinished',
    '</div><p>After a stray close</p>',
    '<style>.panel { color: red }</style><div class="panel">Panel</div>',
    '<input id="toggle" type="checkbox"><label for="toggle">Open</label><div>Panel</div>',
  ])('returns display output verbatim for host rendering: %s', async (html) => {
    setDisplaySnapshot(snapshot());
    expect((await applyRules([displayRule({ replace_string: html })]))?.content).toBe(html);
  });

  test('assembles Risu regex fragments without adding render boundaries', async () => {
    setDisplaySnapshot(snapshot());
    const metadata = { _risu: { origin: 'module' } };
    const result = await applyRules([
      displayRule({ find_regex: 'OPEN', replace_string: '<div class="scene">', metadata }),
      displayRule({ find_regex: 'LINE', replace_string: '<p>{{char}}</p>', metadata }),
      displayRule({ find_regex: 'CLOSE', replace_string: '</div>', metadata }),
    ], 'OPENLINECLOSE');
    expect(result?.content).toBe('<div class="scene"><p>Character</p></div>');
  });

  test('native local variables start empty instead of reading persisted Risu state', async () => {
    const base = snapshot();
    setDisplaySnapshot({ ...base, vars: { local: { route: 'CHAT' }, global: { route: 'GLOBAL' }, chat: {} }, scriptstateDefaults: { fallback: 'DEFAULT' } });
    for (const mode of ['raw', 'after', 'escaped'] as const) {
      const result = await applyRules([displayRule({ substitute_macros: mode,
        replace_string: '{{getvar::route}}|{{getchatvar::route}}|{{getgvar::route}}|{{getvar::fallback}}',
      })]);
      expect(result?.content).toBe('|CHAT|GLOBAL|');
      expect(result?.touchedVars).toContain('local:route');
      expect(result?.touchedVars).toContain('global:route');
    }
  });

  test('null snapshot values use Risu defaults while native rules retain present keys', async () => {
    const base = snapshot();
    setDisplaySnapshot({ ...base, vars: { local: { missing: null, empty: '', literal: 'null' }, global: { missing: null }, chat: {} }, scriptstateDefaults: { missing: 'DEFAULT', empty: 'DEFAULT', literal: 'DEFAULT' } });
    expect((await applyRules([displayRule({ substitute_macros: 'raw', metadata: { _risu: {} },
      replace_string: '{{getvar::missing}}|{{getvar::empty}}|{{getvar::literal}}|{{getglobalvar::missing}}',
    })]))?.content).toBe('DEFAULT||null|null');
    expect((await applyRules([displayRule({ substitute_macros: 'raw',
      replace_string: '{{getchatvar::missing}}|{{haschatvar::missing}}|{{getgvar::missing}}|{{hasgvar::missing}}',
    })]))?.content).toBe('null|true|null|true');
  });

  test('frontend Lua reads null through defaults without rewriting it during an unrelated save', async () => {
    setWasmoonEnabled(false);
    const base = snapshot(`
      listenEdit("editDisplay", function(triggerId, data)
        setChatVar(triggerId, "changed", "yes")
        return getChatVar(triggerId, "missing") .. "|" .. getGlobalVar(triggerId, "missing")
      end)
    `);
    setDisplaySnapshot({ ...base, vars: { local: { missing: null }, global: { missing: null }, chat: {} }, scriptstateDefaults: { missing: 'DEFAULT' } });
    const writes: unknown[] = [];
    const result = await createDisplayResolver((_chatId, vars) => { writes.push(vars); }).resolveBody({
      content: 'text', context: { chatId: 'chat-1', characterId: 'char-1', isUser: false, depth: 0 },
    });
    expect(result?.content).toBe('DEFAULT|null');
    expect(writes).toEqual([{ changed: 'yes' }]);
  });

  test('native scratch writes survive rules and matches without leaking into Risu or later renders', async () => {
    const base = snapshot();
    setDisplaySnapshot({ ...base, vars: { local: { n: '40' }, global: {}, chat: {} } });
    const rules = [
      displayRule({ find_regex: '^', replace_string: '{{setvar::n::1}}', substitute_macros: 'raw' }),
      displayRule({ find_regex: 'x', replace_string: '{{incvar::n}}', substitute_macros: 'raw' }),
      displayRule({ find_regex: '$', replace_string: '|{{getvar::n}}', substitute_macros: 'raw', metadata: { _risu: {} } }),
    ];
    expect((await applyRules(rules, 'xx'))?.content).toBe('23|40');
    expect((await applyRules(rules, 'xx'))?.content).toBe('23|40');
  });

  test('native find macros and captured replacements share their own variable state', async () => {
    setDisplaySnapshot(snapshot());
    const result = await applyRules([
      displayRule({ find_regex: '^', replace_string: '{{setvar::pattern::(TOKEN)}}', substitute_macros: 'raw' }),
      displayRule({ find_regex: '{{getvar::pattern}}', replace_string: '{{setvar::value::$1}}{{getvar::value}}!', substitute_macros: 'raw' }),
    ]);
    expect(result?.content).toBe('TOKEN!');
  });

  test('native persisted-variable reads track refreshes without persisting display writes', async () => {
    const base = snapshot();
    const rules = [displayRule({ substitute_macros: 'after', replace_string:
      '{{getchatvar::route}}|{{setchatvar::route::DISPLAY}}{{getchatvar::route}}',
    })];
    for (const route of ['before', 'after']) {
      setDisplaySnapshot({ ...base, vars: { local: { route }, global: {}, chat: {} } });
      const result = await applyRules(rules);
      expect(result?.content).toBe(`${route}|DISPLAY`);
      expect(result?.touchedVars).toContain('local:route');
      expect(result?.touchedVars).toContain('chat:route');
      expect((await applyRules([displayRule({ substitute_macros: 'raw', replace_string: '{{getchatvar::route}}' })]))?.content).toBe(route);
    }
  });

  for (const mode of ['none', 'find', 'escaped'] as const) {
    test(`native ${mode} rules do not add a Risu parse of the resulting body`, async () => {
      setDisplaySnapshot(snapshot());
      const result = await applyRules([displayRule({ substitute_macros: mode })], 'TOKEN|{{user}}');
      expect(result?.content).toBe(mode === 'escaped' ? 'Character|{{user}}' : '{{char}}|{{user}}');
    });
  }

  for (const origin of ['character', 'module']) {
    test(`Risu ${origin} rules retain processScriptFull post-replacement parsing`, async () => {
      setDisplaySnapshot(snapshot());
      expect((await applyRules([displayRule({ metadata: { _risu: { origin } } })]))?.content).toBe('Character');
    });
  }

  test('interleaved native and Risu rows retain their order and shared text', async () => {
    setDisplaySnapshot(snapshot());
    expect((await applyRules([
      displayRule(),
      displayRule({ find_regex: '\\{\\{char\\}\\}', replace_string: '{{user}}', metadata: { _risu: {} } }),
      displayRule({ find_regex: 'User', replace_string: '{{char}}' }),
    ]))?.content).toBe('{{char}}');
    expect((await applyRules([
      displayRule(),
      displayRule({ find_regex: '$', replace_string: '!', metadata: { _risu: {} } }),
    ]))?.content).toBe('Character!');
  });

  test('malformed provenance does not enable Risu parsing', async () => {
    setDisplaySnapshot(snapshot());
    for (const value of [null, false, 'module', []]) {
      expect((await applyRules([displayRule({ metadata: { _risu: value } })]))?.content).toBe('{{char}}');
    }
  });

  test('attaches native action payloads to each display match without resolving action macros', async () => {
    setDisplaySnapshot(snapshot());
    const result = await createDisplayResolver().applyScripts({
      content: '<choice>Left</choice> <choice align="good">Right</choice>',
      context: { chatId: 'chat-1', characterId: 'char-1', isUser: false, depth: 0 },
      scripts: [{
        id: 'choices', find_regex: '<choice(?: align="(?<align>[^"]+)")?>(?<label>[^<]+)</choice>',
        replace_string: '<button data-align="$<align>" data-regex-action="pick">$<label></button>',
        flags: 'g', placement: ['ai_output'], substitute_macros: 'after',
        trim_strings: [], min_depth: null, max_depth: null,
        actions: [{
          id: 'pick', type: 'send', multi_select: false, cost: '1', limit: '3',
          title: 'Choose $<label>', subtitle: '', content: 'My choice: $<label>. {{char}}',
        }],
      }],
    });
    const payloads = [...(result?.content ?? '').matchAll(/data-lumiverse-regex-action="([^"]+)"/g)]
      .map((match) => JSON.parse(decodeURIComponent(match[1]!)));
    expect(payloads).toEqual([
      {
        id: 'pick', type: 'send', multi_select: false, cost: 1, limit: 0,
        title: 'Choose Left', subtitle: '', content: 'My choice: Left. {{char}}',
        scriptId: 'choices', instanceId: 'choices:0:21',
      },
      {
        id: 'pick', type: 'send', multi_select: false, cost: 1, limit: 0,
        title: 'Choose Right', subtitle: '', content: 'My choice: Right. {{char}}',
        scriptId: 'choices', instanceId: 'choices:22:57',
      },
    ]);
    expect(result?.content).toContain('data-align=""');
    expect(result?.content).toContain('data-align="good"');
  });

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
