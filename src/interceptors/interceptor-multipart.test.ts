import { describe, expect, test } from 'bun:test';
import type { LlmMessageDTO, LlmMessagePartDTO } from 'lumiverse-spindle-types';
import type { TriggerScript } from '../core/schemas/triggerscript.js';
import type { RegexCoreScript } from '../display/regex-core.js';
import type { DispatchData, HostApi, ScriptNS } from '../interpreter/host.js';
import { runListenEditChain } from '../interpreter/listen-edit.js';
import { execute as luaExecute } from '../interpreter/lua-bridge.js';
import { runRequestTriggerChain } from '../interpreter/request-trigger-runner.js';
import { makeRisuRegexRuntime, makeRisuTriggerRuntime } from '../interpreter/runtime.js';
import {
  applyInjectAtToMessages,
  type InjectAtPlan,
} from '../payload/lorebook-decorator-runtime.js';
import { mergeLlmText, projectLlmText } from '../util/llm-message-content.js';
import {
  applyPromptRegexToArray,
  type PrebuiltPipelineInput,
} from './prompt-regex-apply.js';

const regexScript: RegexCoreScript = {
  find_regex: 'X',
  replace_string: 'Y',
  flags: 'g',
  substitute_macros: 'none',
  placement: ['user_input'],
  target: 'prompt',
  min_depth: null,
  max_depth: null,
  trim_strings: [],
};

const injectPlan: InjectAtPlan = {
  entryId: 'inject',
  loc: 'description',
  operation: 'append',
  content: 'EXTRA',
  param: '',
};

function host(): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: 'message' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => ({}),
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id) => ({ id, worldBookIds: [] }),
      update: async () => {},
    },
  };
}

function requestTrigger(effect: TriggerScript['effect']): TriggerScript {
  return { comment: '', type: 'request', conditions: [], effect } as TriggerScript;
}

function scriptNs(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error(`unknown module: ${name}`);
    },
  } as unknown as ScriptNS;
}

const dispatchData: DispatchData = { characterId: 'character' };

describe('current interceptor message DTO', () => {
  test('projects and merges string and multipart text without replacing media', () => {
    expect(projectLlmText('before')).toBe('before');
    expect(mergeLlmText('before', 'after')).toBe('after');

    const image: LlmMessagePartDTO = {
      type: 'image',
      data: 'image-data',
      mime_type: 'image/png',
    };
    const content: LlmMessagePartDTO[] = [
      { type: 'text', text: 'one' },
      image,
      { type: 'text', text: 'two' },
    ];
    expect(projectLlmText(content)).toBe('onetwo');
    expect(mergeLlmText(content, 'onetwo')).toBe(content);
    const merged = mergeLlmText(content, 'changed') as LlmMessagePartDTO[];
    expect(merged).toEqual([{ type: 'text', text: 'changed' }, image]);
    expect(merged[1]).toBe(image);
  });

  test('prompt regex changes text parts and preserves non-text parts and metadata', async () => {
    const image: LlmMessagePartDTO = {
      type: 'image',
      data: 'image-data',
      mime_type: 'image/png',
    };
    const tool: LlmMessagePartDTO = {
      type: 'tool_result',
      tool_use_id: 'tool',
      content: 'tool-output',
    };
    const message: LlmMessageDTO & { runtimeExtra: string } = {
      role: 'user',
      content: [{ type: 'text', text: 'one X' }, image, tool],
      reasoning_content: 'reasoning',
      sourceMessageId: 'source',
      runtimeExtra: 'extra',
    };
    const messages: LlmMessageDTO[] = [message];

    expect((await applyPromptRegexToArray(
      messages,
      {} as PrebuiltPipelineInput,
      [regexScript],
    )).changed).toBe(true);

    const result = messages[0] as typeof message;
    const parts = result.content as LlmMessagePartDTO[];
    expect(parts[0]).toEqual({ type: 'text', text: 'one Y' });
    expect(parts[1]).toBe(image);
    expect(parts[2]).toBe(tool);
    expect(result.reasoning_content).toBe('reasoning');
    expect(result.sourceMessageId).toBe('source');
    expect(result.runtimeExtra).toBe('extra');
  });

  test('inject_at changes multipart text without replacing media or metadata', () => {
    const image: LlmMessagePartDTO = {
      type: 'image',
      data: 'image-data',
      mime_type: 'image/png',
    };
    const message: LlmMessageDTO = {
      role: 'system',
      content: [{ type: 'text', text: 'DESC' }, image],
      name: 'kept',
      sourceMessageId: 'source',
    };
    const result = applyInjectAtToMessages(
      [message],
      [injectPlan],
      { description: 'DESC' },
    );

    expect(result.mutationCount).toBe(1);
    expect(result.synthesizedCount).toBe(0);
    expect(result.messages[0]).toMatchObject({
      role: 'system',
      name: 'kept',
      sourceMessageId: 'source',
    });
    const parts = result.messages[0]!.content as LlmMessagePartDTO[];
    expect(parts[0]).toEqual({ type: 'text', text: 'DESC EXTRA' });
    expect(parts[1]).toBe(image);

    expect(applyInjectAtToMessages(
      [{ role: 'system', content: 'DESC', name: 'kept' }],
      [injectPlan],
      { description: 'DESC' },
    ).messages).toEqual([{ role: 'system', content: 'DESC EXTRA', name: 'kept' }]);
  });

  test('editInput changes multipart text and no-op editRequest preserves the DTO', async () => {
    const image: LlmMessagePartDTO = {
      type: 'image',
      data: 'image-data',
      mime_type: 'image/png',
    };
    const message: LlmMessageDTO & { runtimeExtra: string } = {
      role: 'user',
      content: [{ type: 'text', text: 'before' }, image],
      reasoning_content: 'reasoning',
      sourceMessageId: 'source',
      runtimeExtra: 'extra',
    };
    const editedText = await runListenEditChain(
      [{
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editInput', function(id, value, meta) return value .. ' after' end)`,
      }],
      'editInput',
      projectLlmText(message.content),
      {},
      host(),
      dispatchData,
      scriptNs(),
    );
    const editedContent = mergeLlmText(message.content, editedText) as LlmMessagePartDTO[];
    expect(editedContent[0]).toEqual({ type: 'text', text: 'before after' });
    expect(editedContent[1]).toBe(image);

    const result = await runListenEditChain(
      [{
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editRequest', function(id, value, meta) return value end)`,
      }],
      'editRequest',
      [message],
      {},
      host(),
      dispatchData,
      scriptNs(),
    );
    expect(result).toEqual([message]);
  });

  test('request triggers preserve string behavior and merge multipart text', async () => {
    const trigger = requestTrigger([
      {
        type: 'v2SetRequestState',
        index: '0',
        indexType: 'value',
        value: 'changed',
        valueType: 'value',
      },
      {
        type: 'v2SetRequestStateRole',
        index: '0',
        indexType: 'value',
        value: 'assistant',
        valueType: 'value',
      },
    ] as TriggerScript['effect']);
    const stringMessage: LlmMessageDTO = {
      role: 'user',
      content: 'before',
      name: 'kept',
      reasoning_content: 'reasoning',
    };
    expect(await runRequestTriggerChain([stringMessage], {
      api: host(),
      chatId: 'chat',
      characterId: 'character',
      triggers: [trigger],
    })).toEqual([{
      ...stringMessage,
      role: 'assistant',
      content: 'changed',
    }]);

    const image: LlmMessagePartDTO = {
      type: 'image',
      data: 'image-data',
      mime_type: 'image/png',
    };
    const audio: LlmMessagePartDTO = {
      type: 'audio',
      data: 'audio-data',
      mime_type: 'audio/wav',
    };
    const multipartMessage: LlmMessageDTO = {
      role: 'user',
      content: [{ type: 'text', text: 'before' }, image, audio],
      sourceMessageId: 'source',
      reasoning_content: 'reasoning',
    };
    const result = await runRequestTriggerChain([multipartMessage], {
      api: host(),
      chatId: 'chat',
      characterId: 'character',
      triggers: [trigger],
    });
    const parts = result[0]!.content as LlmMessagePartDTO[];
    expect(result[0]).toMatchObject({
      role: 'assistant',
      sourceMessageId: 'source',
      reasoning_content: 'reasoning',
    });
    expect(parts[0]).toEqual({ type: 'text', text: 'changed' });
    expect(parts[1]).toBe(image);
    expect(parts[2]).toBe(audio);
  });
});
