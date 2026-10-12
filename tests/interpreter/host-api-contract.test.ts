import { afterEach, describe, expect, test } from 'bun:test';
import type { HostApi, InjectOpts, ScriptNS } from '../../src/interpreter/host.js';
import {
  preloadForListenEditChain,
  resetListenEditPreloadCache,
} from '../../src/interpreter/listenedit-preload.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeChatApi } from '../../src/interpreter/runtime/chat.js';

function harness(options: { characterError?: Error; injectError?: Error } = {}) {
  const characterGets: string[] = [];
  const injects: Array<{ id: string; content: string; opts: InjectOpts | undefined }> = [];
  const api: HostApi = {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: 'message' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => ({}),
      setMetadata: async () => {},
      inject: async (id, content, opts) => {
        injects.push({ id, content, opts });
        if (options.injectError) throw options.injectError;
      },
    },
    characters: {
      get: async (id) => {
        characterGets.push(id);
        if (options.characterError) throw options.characterError;
        return { id, worldBookIds: [] };
      },
      update: async () => {},
    },
  };
  return { api, characterGets, injects };
}

const scriptNs: ScriptNS = { require: async () => ({}) };

afterEach(() => {
  resetListenEditPreloadCache();
});

describe('required HostApi members', () => {
  test('runtime character reads keep ID guards and rejection isolation', async () => {
    const read = harness();
    await makeRisuTriggerRuntime(
      read.api,
      { characterId: 'character' },
      scriptNs,
      { characterId: 'character' },
    );
    expect(read.characterGets).toEqual(['character']);

    const noId = harness();
    await makeRisuTriggerRuntime(noId.api, {}, scriptNs);
    expect(noId.characterGets).toEqual([]);

    const rejected = harness({ characterError: new Error('characters unavailable') });
    await expect(makeRisuTriggerRuntime(
      rejected.api,
      { characterId: 'character' },
      scriptNs,
      { characterId: 'character' },
    )).resolves.toBeDefined();
    expect(rejected.characterGets).toEqual(['character']);
  });

  test('listenEdit preload character reads keep ID guards and rejection isolation', async () => {
    const read = harness();
    const snapshot = await preloadForListenEditChain(read.api, 'read-chat', 'character');
    expect(read.characterGets).toEqual(['character']);
    expect(snapshot.lorebook).toEqual({ entries: [], primaryBookId: null });

    const noId = harness();
    await preloadForListenEditChain(noId.api, 'no-id-chat', null);
    expect(noId.characterGets).toEqual([]);

    const rejected = harness({ characterError: new Error('characters unavailable') });
    await expect(preloadForListenEditChain(
      rejected.api,
      'rejected-chat',
      'character',
    )).resolves.toMatchObject({ messagesRaw: [] });
    expect(rejected.characterGets).toEqual(['character']);
  });

  test('chat injections keep their arguments and isolate rejections', async () => {
    const rejected = harness({ injectError: new Error('inject unavailable') });
    const state = {
      messagesCache: [],
      loopCounter: { value: 0 },
      additionalSysPrompt: { start: '', historyend: '', promptend: '' },
    };
    const chat = makeChatApi(rejected.api, state, () => {});
    expect(await chat.systemPrompt('historyend', 'system text')).toBeUndefined();


    expect(rejected.injects[0]).toEqual({
      id: 'risu-sys-historyend-1',
      content: 'system text',
      opts: { mode: 'context', position: 'historyend', role: 'system' },
    });
    expect(state.additionalSysPrompt.historyend).toBe('system text\n\n');
  });
});
