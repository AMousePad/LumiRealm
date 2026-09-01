import { describe, expect, test } from 'bun:test';
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
