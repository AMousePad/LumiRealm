import { afterEach, expect, test } from 'bun:test';
import type { HostApi, HostMessage, TriggerRuntimeOpts } from '../../src/interpreter/host.js';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { runListenEditChain } from '../../src/interpreter/listen-edit.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';

afterEach(() => clearLuaEngines());

function fixture() {
  const messages: HostMessage[] = [{ id: 'message', content: 'initial', role: 'user' }];
  const edits: string[] = [];
  const forbidden = async (): Promise<never> => { throw new Error('Unexpected host read'); };
  const api: HostApi = {
    chat: { getMessages: forbidden, getMetadata: forbidden, setMetadata: forbidden,
      sendMessage: forbidden, deleteMessage: forbidden, inject: forbidden,
      editMessage: async (_id, text) => { edits.push(text); } },
    characters: { get: forbidden, update: forbidden },
  };
  const opts = {
    chatId: 'chat', characterId: 'character', binding: 'manual',
    luaChat: { messages, firstMessage: 'greeting' },
    preloaded: { varsCache: {}, globalVars: {}, messagesRaw: messages, lorebook: { entries: [], primaryBookId: null },
      luaState: { character: { id: 'character' }, persona: null, authorsNote: '' } },
    luaTemplate: text => text,
  } satisfies TriggerRuntimeOpts;
  return { messages, edits, api, opts };
}

test('a suspended edit hook observes a message changed through the shared browser chat', async () => {
  const { messages, api, opts } = fixture();
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<string>();
  const script = makeDispatcherScriptNS((code, globals, options) => execute(code, {
    ...globals, hash: () => { entered.resolve(); return released.promise; },
  }, options));
  const pending = runListenEditChain([{ source: { effect: [{ type: 'triggerlua' }] },
    luaCode: `listenEdit('editRequest', function(id, value)
      hash(id,'pause'):await()
      return getChat(id,0).data
    end)`,
  }], 'editRequest', 'input', {}, api, {}, script, opts);
  await entered.promise;
  messages[0] = { ...messages[0]!, content: 'edited while suspended' };
  released.resolve('hash');
  expect(await pending).toBe('edited while suspended');
});

test('a button mutation is visible to another runtime before persistence completes', async () => {
  const { messages, edits, api, opts } = fixture();
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  api.chat.editMessage = async (_id, text) => { entered.resolve(); await released.promise; edits.push(text); };
  const script = makeDispatcherScriptNS(execute);
  const runtime = await makeRisuTriggerRuntime(api, {}, script, opts);
  const pending = runtime.runLua('function onButtonClick(id) setChat(id,0,"local") end');
  await entered.promise;
  const reader = await makeRisuTriggerRuntime(api, {}, script, opts);
  expect(await reader.runLua('function read(id) return getChat(id,0).data end', { entry: 'read' })).toBe('local');
  expect(messages[0]!.content).toBe('local');
  expect(edits).toEqual([]);
  released.resolve();
  await pending;
  expect(edits).toEqual(['local']);
});

test('runTrigger keeps its copied chat even when a caller supplies a live chat', async () => {
  const { messages, api, opts } = fixture();
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(execute), {
    ...opts, invocationState: { stopSending: false },
  });
  messages[0] = { ...messages[0]!, content: 'later' };
  expect(await runtime.runLua('function read(id) return getChat(id,0).data end', { entry: 'read' })).toBe('initial');
});
