import { describe, expect, test } from 'bun:test';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import type { HostApi } from '../../src/interpreter/host.js';
import { runRequestTriggerChain } from '../../src/interpreter/request-trigger-runner.js';

function host(writeCount: { value: number }): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: 'message' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => ({}),
      setMetadata: async () => { writeCount.value++; },
      inject: async () => {},
    },
    characters: {
      get: async (id) => ({ id, worldBookIds: [] }),
      update: async () => {},
    },
  };
}

function requestTrigger(effect: TriggerScript['effect']): TriggerScript {
  return { type: 'request', comment: '', conditions: [], effect } as TriggerScript;
}

describe('structured request triggers', () => {
  test('mutates final request state with Risu bounds and role semantics', async () => {
    const writes = { value: 0 };
    const messages = [
      { role: 'system' as const, content: 'system', name: 'kept' },
      { role: 'user' as const, content: 'question' },
    ];
    const result = await runRequestTriggerChain(messages, {
      api: host(writes),
      chatId: 'chat',
      characterId: 'character',
      triggers: [requestTrigger([
        { type: 'v2GetRequestStateLength', outputVar: 'length' },
        {
          type: 'v2GetRequestState',
          index: '99',
          indexType: 'value',
          outputVar: 'missing',
        },
        {
          type: 'v2ConcatString',
          source1: 'length',
          source1Type: 'var',
          source2: ':',
          source2Type: 'value',
          outputVar: 'summary',
        },
        {
          type: 'v2ConcatString',
          source1: 'summary',
          source1Type: 'var',
          source2: 'missing',
          source2Type: 'var',
          outputVar: 'summary',
        },
        {
          type: 'v2SetRequestState',
          index: '0',
          indexType: 'value',
          value: 'summary',
          valueType: 'var',
        },
        {
          type: 'v2SetRequestStateRole',
          index: '0',
          indexType: 'value',
          value: 'invalid',
          valueType: 'value',
        },
        {
          type: 'v2SetRequestStateRole',
          index: '1',
          indexType: 'value',
          value: 'assistant',
          valueType: 'value',
        },
      ] as TriggerScript['effect'])],
    });

    expect(result).toEqual([
      { role: 'system', content: '2:null', name: 'kept' },
      { role: 'assistant', content: 'question' },
    ]);
    expect(messages[0]).toEqual({ role: 'system', content: 'system', name: 'kept' });
    expect(writes.value).toBe(0);
  });

  test('ignores other bindings', async () => {
    const writes = { value: 0 };
    const messages = [{ role: 'user' as const, content: 'kept' }];
    const result = await runRequestTriggerChain(messages, {
      api: host(writes),
      chatId: 'chat',
      characterId: 'character',
      triggers: [{
        type: 'display',
        comment: '',
        conditions: [],
        effect: [{
          type: 'v2SetRequestState',
          index: '0',
          indexType: 'value',
          value: 'wrong',
          valueType: 'value',
        }],
      } as TriggerScript],
    });
    expect(result).toEqual(messages);
    expect(writes.value).toBe(0);
  });

  test('rejects an out-of-range write like Risu JSON request state', async () => {
    const writes = { value: 0 };
    await expect(runRequestTriggerChain(
      [{ role: 'user', content: 'kept' }],
      {
        api: host(writes),
        chatId: 'chat',
        characterId: 'character',
        triggers: [requestTrigger([{
          type: 'v2SetRequestState',
          index: '4',
          indexType: 'value',
          value: 'wrong',
          valueType: 'value',
        }] as TriggerScript['effect'])],
      },
    )).rejects.toThrow('request state index out of range');
    expect(writes.value).toBe(0);
  });
});
