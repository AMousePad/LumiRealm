import { afterEach, expect, test } from 'bun:test';
import { LuaFactory } from 'wasmoon';
import { createLuaExecutor } from '../../src/interpreter/lua-engine.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import json from '../../src/interpreter/lua-json.lua' with { type: 'text' };
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const host = makeLuaDivergenceHost();
  const mirror = structuredClone(host.messages.slice(1));
  const refs = [...mirror], before = structuredClone(mirror), stored = structuredClone(host.messages);
  const writes: string[] = [];
  const send = host.api.chat.sendMessage, edit = host.api.chat.editMessage, remove = host.api.chat.deleteMessage;
  host.api.chat.sendMessage = (...args) => { writes.push('send'); return send(...args); };
  host.api.chat.editMessage = (...args) => { writes.push('edit'); return edit(...args); };
  host.api.chat.deleteMessage = (...args) => { writes.push('delete'); return remove(...args); };
  let queued = 0;
  let tail = Promise.resolve();
  const factory = new LuaFactory();
  await factory.mountFile('json.lua', json);
  const executor = createLuaExecutor(async () => factory);
  cleanups.push(() => executor.clear());
  const runtime = await makeRisuTriggerRuntime(host.api, {}, { require: async () => executor }, {
    characterId: 'test-character', chatId: 'test-chat', binding: 'start',
    preloaded: host.preloaded, templateContext: basicTriggerContext,
    luaChat: { messages: mirror, firstMessage: 'Greeting', enqueue: operation => {
      queued++;
      tail = tail.then(operation);
      return tail;
    } },
  });
  return { host, runtime, executor, mirror, writes, assertUnchanged() {
    expect(mirror).toEqual(before);
    refs.forEach((message, index) => expect(mirror[index]).toBe(message));
    expect(host.messages).toEqual(stored);
    expect(writes).toEqual([]);
    expect(queued).toBe(0);
    expect(host.metadata.chat_variables).toEqual({ x: '2' });
  } };
}

const invalid = [
  ['malformed JSON', "setFullChatMain(id,'invalid')"],
  ['missing input', 'setFullChatMain(id)'],
  ['nil input', 'setFullChatMain(id,nil)'],
  ['number input', 'setFullChatMain(id,42)'],
  ['boolean input', 'setFullChatMain(id,true)'],
  ['table input', 'setFullChatMain(id,{value=1})'],
  ['array table input', 'setFullChatMain(id,{1,2})'],
  ['JSON null', "setFullChatMain(id,'null')"],
  ['JSON object', "setFullChatMain(id,'{}')"],
  ['JSON string', `setFullChatMain(id,'"text"')`],
  ['JSON number', "setFullChatMain(id,'42')"],
  ['null row', "setFullChatMain(id,'[null]')"],
  ['null after a valid row', `setFullChatMain(id,'[{"role":"user","data":"Changed"},null]')`],
  ['public wrapper scalar', "setFullChat(id,'text')"],
] as const;

for (const [name, operation] of invalid) {
  for (const mode of ['plain', 'async', 'pcall'] as const) {
    test(`${mode} full-chat replacement rejects ${name} before mutation`, async () => {
      const f = await fixture();
      const body = mode === 'pcall' ? `local ok=pcall(function() ${operation} end);return tostring(ok)`
        : `${operation};setChatVar(id,'after','1');return 'continued'`;
      const code = mode === 'async' ? `onStart=async(function(id) ${body} end)` : `function onStart(id) ${body} end`;
      const result = await f.runtime.runLua(code);
      await f.runtime.flush();
      expect(result).toBe(mode === 'pcall' ? 'false' : undefined);
      f.assertUnchanged();
    });
  }
}

test('a protected full-chat failure stops only the protected callback', async () => {
  const f = await fixture();
  expect(await f.runtime.runLua(`function onStart(id)
    local ok=pcall(function()
      setFullChatMain(id,'[null]');setChatVar(id,'skipped','yes')
    end)
    setChatVar(id,'resumed','yes');return tostring(ok)
  end`)).toBe('false');
  await f.runtime.flush();
  expect(f.host.metadata.chat_variables).toEqual({ x: '2', resumed: 'yes' });
  expect(f.writes).toEqual([]);
});

for (const value of ['[]', '[42]', '[false]', '["text"]', '[{}]', '[{"role":"user","data":"Changed"}]']) {
  test(`full-chat replacement retains accepted shape ${value}`, async () => {
    const f = await fixture();
    expect(await f.runtime.runLua(`function onStart(id) setFullChatMain(id,[=[${value}]=]);return 'continued' end`)).toBe('continued');
    await f.runtime.flush();
    expect(f.mirror.length).toBe(JSON.parse(value).length);
  });
}

test('full-chat replacement checks the access ID before parsing', async () => {
  const f = await fixture();
  expect(await f.runtime.runLua("function onStart(id) setFullChatMain('forged','invalid');return 'continued' end")).toBe('continued');
  await f.runtime.flush();
  f.assertUnchanged();
});

test('display callbacks deny full-chat replacement before parsing', async () => {
  const f = await fixture();
  const code = "listenEdit('editDisplay',function(id,text) setFullChatMain(id,'invalid');return text..' continued' end)";
  expect(await f.runtime.runLua(code, {
    entry: 'callListenMain', mode: 'editDisplay', args: ['editDisplay', undefined, '"Input"', '{}'],
  })).toBe('Input continued');
  await f.runtime.flush();
  f.assertUnchanged();
});

test('a failed replacement does not hide an earlier frontend persistence failure', async () => {
  const f = await fixture();
  const writes: string[] = [];
  const state = new FrontendRuntimeState({
    revision: { epoch: 'host', sequence: 1 }, chat: { id: 'test-chat', metadata: {} },
    character: { id: 'test-character', name: 'Character' }, persona: null,
    messages: f.host.messages.map((message, index) => ({ ...message, index_in_chat: index })), lore: [], globalVariables: {},
  }, async command => { writes.push(command.kind); throw new Error('Edit rejected'); }, () => {});
  const runtime = await makeRisuTriggerRuntime(f.host.api, {}, { require: async () => f.executor }, {
    characterId: 'test-character', chatId: 'test-chat', binding: 'start',
    preloaded: f.host.preloaded, templateContext: basicTriggerContext,
    luaChat: state.luaChat({ ...f.host.api.chat, async editMessage(id, content) {
      await state.write({ kind: 'message.edit', id, content }, false);
    } }),
  });
  expect(await runtime.runLua(`function onStart(id)
    setChat(id,0,'Earlier');setFullChatMain(id,'[null]');return 'continued'
  end`)).toBeUndefined();
  await runtime.flush();
  await expect(state.flush()).rejects.toThrow('Frontend Lua persistence failed');
  expect(writes).toEqual(['message.edit']);
  expect(state.messages.map(message => message.content)).toEqual(['Hello', 'Welcome']);
});

for (const mode of ['plain', 'async'] as const) {
  test(`${mode} failed replacement preserves earlier authored effects`, async () => {
    const f = await fixture();
    const body = `setChat(id,0,'Earlier');setChatVar(id,'saved','yes');addChat(id,'user','Added');
      setFullChatMain(id,'[{"role":"user","data":"Wrong"},null]');setChat(id,1,'Later');return 'continued'`;
    expect(await f.runtime.runLua(mode === 'async' ? `onStart=async(function(id) ${body} end)` : `function onStart(id) ${body} end`)).toBeUndefined();
    await f.runtime.flush();
    expect(f.mirror.map(message => message.content)).toEqual(['Earlier', 'Welcome', 'Added']);
    expect(f.host.messages.map(message => message.content)).toEqual(['Greeting', 'Earlier', 'Welcome', 'Added']);
    expect(f.host.metadata.chat_variables).toEqual({ x: '2', saved: 'yes' });
    expect(f.writes).toEqual(['edit', 'send']);
  });
}
