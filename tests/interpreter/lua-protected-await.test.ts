import { afterEach, describe, expect, test } from 'bun:test';
import type { HostApi } from '../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';

import { clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';

afterEach(clearLuaEngines);

async function runtimeWithHost(generate: NonNullable<HostApi['llm']>['generate']) {
  const host = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime({ ...host.api, llm: { generate } }, {}, divergenceLuaScriptNS, {
    binding: 'start', lowLevelAccess: true,
  });
  return { runtime, metadata: host.metadata };
}

describe('Lua protected host awaits', () => {
  for (const [name, reason] of [
    ['Error', new Error('host failed')], ['string', 'host failed'], ['undefined', undefined],
    ['Error with undefined message', Object.defineProperty(new Error('host failed'), 'message', { value: undefined })],
    ['null', null], ['false', false], ['zero', 0], ['empty string', ''],
  ] as const) {
    test(`pcall handles ${name} rejection on first and repeated awaits`, async () => {
      let calls = 0;
      const { runtime, metadata } = await runtimeWithHost(async () => { calls++; throw reason; });
      await runtime.runLua(`onStart = async(function(id)
        local pending = simpleLLM(id, 'prompt')
        for i=1,2 do
          local ok = pcall(function() pending:await() end)
          setChatVar(id, 'ok'..i, tostring(ok))
        end
        local ok = pcall(function() simpleLLM(id,'prompt'):await() end)
        setChatVar(id, 'secondPromise', tostring(ok))
        setChatVar(id, 'continued', 'yes')
      end)`);
      await runtime.flush();
      expect(metadata.chat_variables).toEqual({ x: '2', ok1: 'false', ok2: 'false', secondPromise: 'false', continued: 'yes' });
      expect(calls).toBe(2);
    });
  }

  test('xpcall invokes its Lua error handler', async () => {
    const { runtime, metadata } = await runtimeWithHost(async () => { throw new Error('host failed'); });
    await runtime.runLua(`onStart = async(function(id)
      local ok, value = xpcall(function() simpleLLM(id,'prompt'):await() end, function(err) return 'handled' end)
      setChatVar(id, 'ok', tostring(ok)); setChatVar(id, 'result', value)
    end)`);
    await runtime.flush();
    expect(metadata.chat_variables).toEqual({ x: '2', ok: 'false', result: 'handled' });
  });

  test('an unhandled rejection stops the callback', async () => {
    const { runtime, metadata } = await runtimeWithHost(async () => { throw new Error('host failed'); });
    expect(await runtime.runLua(`onStart = async(function(id)
      simpleLLM(id,'prompt'):await(); setChatVar(id,'continued','yes')
    end)`)).toBeUndefined();
    await runtime.flush();
    expect(metadata.chat_variables).toEqual({ x: '2' });
  });

  test('a resolved promise can still be awaited repeatedly', async () => {
    let calls = 0;
    const { runtime, metadata } = await runtimeWithHost(async () => { calls++; return { content: 'answer' }; });
    await runtime.runLua(`onStart = async(function(id)
      local pending = simpleLLM(id,'prompt')
      setChatVar(id,'first',pending:await().result);setChatVar(id,'second',pending:await().result)
    end)`);
    await runtime.flush();
    expect(metadata.chat_variables).toEqual({ x: '2', first: 'answer', second: 'answer' });
    expect(calls).toBe(1);
  });
});
