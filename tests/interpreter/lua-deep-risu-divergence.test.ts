import { afterEach, expect, test } from 'bun:test';
import { LuaFactory } from 'wasmoon';
import { createLuaExecutor } from '../../src/interpreter/lua-engine.js';
import { clearLuaEngines, execute } from '../../src/interpreter/lua-bridge.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { hostCharacterState } from '../../src/interpreter/runtime/lua-state.js';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';
import json from '../../src/interpreter/lua-json.lua' with { type: 'text' };
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';

// Expectations verified against complete Risu e565563a runScripted and risuChatParser bodies.
const divergence = process.env.RISU_PARITY_STRICT === '1' ? test : test.failing;
afterEach(() => clearLuaEngines());

async function runtime(host = makeLuaDivergenceHost(), script = divergenceLuaScriptNS) {
  return makeRisuTriggerRuntime(host.api, {}, script, {
    characterId: 'test-character', binding: 'start', templateContext: basicTriggerContext,
  });
}

test('Lua CBS default conditions do not imply a greeting', async () => {
  const rt = await runtime();
  expect(await rt.runLua(`function onStart(id) return cbs('{{isfirstmsg}}|{{role}}') end`)).toBe('0|null');
});

for (const [name, body, expected] of [
  ['full replacement removes timestamps', 'setFullChat(id,getFullChat(id));return getChat(id,0).time', 0],
  ['role edits preserve timestamps', "setChatRole(id,0,'char');return getChat(id,0).time..'|'..getChat(id,1).time", '1700000000000|1700000005000'],
  ['insertion preserves shifted timestamps', "insertChat(id,0,'user','Inserted');return getChat(id,1).time", 1700000000000],
] as const) {
  divergence(name, async () => {
    const rt = await runtime();
    const result = await rt.runLua(`function onStart(id) ${body} end`);
    await rt.flush();
    expect(result).toBe(expected);
  });
}

test('invalid full-chat JSON aborts the callback', async () => {
  const rt = await runtime();
  expect(await rt.runLua(`function onStart(id) setFullChatMain(id,'invalid');return 'continued' end`)).toBeUndefined();
});

divergence('setChat retains the supplied scalar type in Lua reads', async () => {
  const rt = await runtime();
  const result = await rt.runLua(`function onStart(id) setChat(id,0,42);return type(getChat(id,0).data) end`);
  await rt.flush();
  expect(result).toBe('number');
});

divergence('local hashing does not fail when an unrelated identity read becomes unavailable', async () => {
  const host = makeLuaDivergenceHost();
  let reads = 0;
  const personas = {
    getActive: async () => { if (++reads > 1) throw Error('persona unavailable'); return null; },
    update: async () => {},
  };
  const rt = await runtime({ ...host, api: { ...host.api, personas } });
  expect(await rt.runLua(`onStart=async(function(id) return hash(id,'x'):await() end)`))
    .toBe('2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
});

divergence('CBS reads the current scenario after an external edit during suspension', async () => {
  const host = makeLuaDivergenceHost();
  let scenario = 'Old scenario';
  host.api.characters.get = async () => hostCharacterState({ ...host.character, scenario, first_mes: 'Greeting' });
  const rt = await makeRisuTriggerRuntime(host.api, {}, { require: async () => ({
    execute: (code: string, globals: Record<string, unknown>, opts: Parameters<typeof execute>[2]) =>
      execute(code, { ...globals, hash: async () => { scenario = 'New scenario'; return 'hash'; } }, opts),
  }) }, {
    characterId: 'test-character', binding: 'start',
    templateContext: async () => ({ ...await basicTriggerContext(), character: { scenario } }),
  });
  expect(await rt.runLua(`onStart=async(function(id)
    local before=cbs('{{scenario}}');hash(id,'x'):await();return before..'|'..cbs('{{scenario}}')
  end)`)).toBe('Old scenario|New scenario');
});

divergence('the production message adapter retains the timestamp for Lua reads', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'spindle');
  Object.defineProperty(globalThis, 'spindle', { configurable: true, value: {
    generate: { raw: async () => {} },
    chat: { getMessages: async () => [{ id: 'message', role: 'user', content: 'Hello', send_date: 1700000000000 }] },
  } });
  let time: number | undefined;
  try {
    time = (await makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: undefined }).chat.getMessages())[0]?.createdAt;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'spindle', previous);
    else Reflect.deleteProperty(globalThis, 'spindle');
  }
  expect(time).toBe(1700000000000);
});

divergence('display access IDs remain valid across the two execution paths for one operator', async () => {
  const factory = new LuaFactory();
  await factory.mountFile('json.lua', json);
  const frontend = createLuaExecutor(async () => factory), backend = createLuaExecutor(async () => factory);
  const vars: Record<string, string> = { x: '2' };
  const globals = {
    getChatVar: (_id: unknown, key: string) => vars[key] ?? 'null',
    setChatVar: (_id: unknown, key: string, value: string) => { vars[key] = value; },
  };
  let result: unknown;
  try {
    await frontend.execute(`listenEdit('editDisplay',function(id,text) setChatVar(id,'savedId',id);return text end)`, globals,
      { mode: 'editDisplay', entry: 'callListenMain', args: ['editDisplay', '', '"input"', '{}'], enforceAccess: true });
    result = await backend.execute(`function onStart(id) setChatVar(getChatVar(id,'savedId'),'x','7');return getChatVar(id,'x') end`, globals,
      { mode: 'start', entry: 'onStart', enforceAccess: true });
  } finally { await frontend.clear(); await backend.clear(); }
  expect(result).toBe('7');
});
