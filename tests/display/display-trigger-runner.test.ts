import { describe, expect, spyOn, test } from 'bun:test';
import { runDisplayTriggerChain } from '../../src/display/trigger-runner.js';
import type { DisplaySnapshot } from '../../src/display/snapshot.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';

function snapshot(trigger: TriggerScript): DisplaySnapshot {
  return {
    chatId: 'chat',
    characterId: 'character',
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
      firstMessage: 'Greeting',
      alternateGreetings: [],
      selectedAlternateGreetingIndex: -1,
      additionalAssets: {},
      emotionImages: {},
      image: '',
      imageId: null,
    },
    chat: {
      messageCount: 2,
      lastMessage: 'input',
      lastUserMessage: '',
      lastCharMessage: 'input',
      lastMessageId: 1,
      messages: [{ role: 'assistant', content: 'input', createdAt: 0 }],
    },
    vars: { local: { persisted: 'original' }, global: {}, chat: {} },
    scriptstateDefaults: { defaulted: 'card default' },
    screenWidth: 1920,
    screenHeight: 1080,
    legacyMediaFindings: false,
    modulesByNamespace: {},
    lorebook: [],
    hasEditDisplayLua: false,
    hasEditAtActions: false,
    luaTriggers: [{ source: trigger, luaCode: '' }],
    messagesHost: [
      { id: 'greeting', role: 'assistant', content: 'Greeting' },
      { id: 'message', role: 'assistant', content: 'input' },
    ],
    lorebookHost: [],
    atActions: [],
    compiledLibraries: [],
  };
}

describe('frontend structured display triggers', () => {
  test('an invocation abort discards earlier display changes and skips later siblings', async () => {
    const snap = snapshot({ type: 'display', comment: '', conditions: [], effect: [
      { type: 'v2SetDisplayState', value: 'discarded', valueType: 'value' },
      { type: 'v2MakeArrayVar', var: '[]' },
    ] } as TriggerScript);
    const result = await runDisplayTriggerChain({ ...snap, luaTriggers: [...snap.luaTriggers, { luaCode: '', source: {
      type: 'display', comment: '', conditions: [], effect: [{ type: 'v2SetDisplayState', value: 'later', valueType: 'value' }],
    } as TriggerScript }] }, 'original');
    expect(result).toEqual({ content: 'original', ran: true });
  });

  test('evaluates trigger macros from the snapshot without host requests', async () => {
    const network = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    try {
      const snap = snapshot({ type: 'display', comment: '', conditions: [], effect: [
        { type: 'v2SetDisplayState', value: '{{char}}: {{getvar::persisted}} / {{getvar::defaulted}}', valueType: 'value' },
      ] } as TriggerScript);
      expect(await runDisplayTriggerChain(snap, 'input')).toEqual({ content: 'Character: original / card default', ran: true });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  test('runs in Risu order against the current display text', async () => {
    const result = await runDisplayTriggerChain(snapshot({
      type: 'display',
      comment: '',
      conditions: [],
      effect: [
        { type: 'v2GetDisplayState', outputVar: 'body' },
        {
          type: 'v2ConcatString',
          source1: 'body',
          source1Type: 'var',
          source2: '!',
          source2Type: 'value',
          outputVar: 'body',
        },
        {
          type: 'v2SetDisplayState',
          value: 'body',
          valueType: 'var',
        },
      ],
    } as TriggerScript), 'panel');

    expect(result).toEqual({ content: 'panel!', ran: true });
  });

  test('keeps display variable writes ephemeral and reads card defaults', async () => {
    const snap = snapshot({
      type: 'display',
      comment: '',
      conditions: [],
      effect: [
        {
          type: 'v2ConcatString',
          source1: 'persisted',
          source1Type: 'var',
          source2: ' + ',
          source2Type: 'value',
          outputVar: 'rendered',
        },
        {
          type: 'v2ConcatString',
          source1: 'rendered',
          source1Type: 'var',
          source2: 'defaulted',
          source2Type: 'var',
          outputVar: 'rendered',
        },
        {
          type: 'v2SetVar',
          var: 'persisted',
          value: 'changed only here',
          valueType: 'value',
          operator: '=',
        },
        {
          type: 'v2SetDisplayState',
          value: 'rendered',
          valueType: 'var',
        },
      ],
    } as TriggerScript);

    expect(await runDisplayTriggerChain(snap, 'ignored')).toEqual({
      content: 'original + card default',
      ran: true,
    });
    expect(snap.vars.local.persisted).toBe('original');
    expect(await runDisplayTriggerChain(snap, 'ignored')).toEqual({
      content: 'original + card default',
      ran: true,
    });
  });

  test('does not run non-display bindings or Lua-only no-op rows', async () => {
    const start = snapshot({
      type: 'start',
      comment: '',
      conditions: [],
      effect: [{
        type: 'v2SetDisplayState',
        value: 'wrong',
        valueType: 'value',
      }],
    } as TriggerScript);
    expect(await runDisplayTriggerChain(start, 'kept')).toEqual({
      content: 'kept',
      ran: false,
    });

    const luaOnly = snapshot({
      type: 'start',
      comment: '',
      conditions: [],
      effect: [{ type: 'triggerlua', code: 'function onStart() end' }],
    } as TriggerScript);
    expect(await runDisplayTriggerChain(luaOnly, 'kept')).toEqual({
      content: 'kept',
      ran: false,
    });
  });
});
