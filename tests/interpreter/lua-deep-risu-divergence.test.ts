import { afterEach, expect, test } from 'bun:test';
import { clearLuaEngines } from '../helpers/lua-bridge.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';

// Expectations verified against complete Risu e565563a runScripted and risuChatParser bodies.
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
  test(name, async () => {
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

test('setChat retains the supplied scalar type in Lua reads', async () => {
  const rt = await runtime();
  const result = await rt.runLua(`function onStart(id) setChat(id,0,42);return type(getChat(id,0).data) end`);
  await rt.flush();
  expect(result).toBe('number');
});
