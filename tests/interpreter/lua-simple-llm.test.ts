import { afterEach, describe, expect, test } from 'bun:test';
import type { HostApi } from '../../src/interpreter/host';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime';
import { clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';

afterEach(clearLuaEngines);

async function runtimeWithLlm(generate: NonNullable<HostApi['llm']>['generate'], lowLevelAccess = true) {
  const host = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime({ ...host.api, llm: { generate } }, {}, divergenceLuaScriptNS, {
    binding: 'start', lowLevelAccess,
  });
  return { runtime, metadata: host.metadata };
}

describe('Lua simpleLLM successful response fields', () => {
  test.each(['answer', '', ' "quoted"\n한글\n'])('preserves response %j', async content => {
    const requests: unknown[] = [];
    const { runtime, metadata } = await runtimeWithLlm(async request => {
      requests.push(request);
      return { content };
    });
    await runtime.runLua(`onStart = async(function(id)
      local response = simpleLLM(id, 'prompt'):await()
      setChatVar(id, 'successType', type(response.success))
      setChatVar(id, 'success', tostring(response.success))
      setChatVar(id, 'resultType', type(response.result))
      setChatVar(id, 'result', response.result)
    end)`);
    await runtime.flush();
    expect(metadata.chat_variables).toEqual({
      x: '2', successType: 'boolean', success: 'true', resultType: 'string', result: content,
    });
    expect(requests).toEqual([{ messages: [{ role: 'user', content: 'prompt' }] }]);
  });

  test('a thrown request aborts the callback instead of returning a success', async () => {
    const { runtime, metadata } = await runtimeWithLlm(async () => { throw new Error('generation failed'); });
    expect(await runtime.runLua(`onStart = async(function(id)
      simpleLLM(id, 'prompt'):await()
      setChatVar(id, 'completed', 'true')
    end)`)).toBeUndefined();
    await runtime.flush();
    expect(metadata.chat_variables).toEqual({ x: '2' });
  });

  test('disabled low-level access never calls the provider', async () => {
    let called = false;
    const { runtime } = await runtimeWithLlm(async () => { called = true; return { content: 'unused' }; }, false);
    expect(await runtime.runLua(`onStart = async(function(id) return simpleLLM(id, 'prompt'):await() end)`)).toBeNull();
    expect(called).toBe(false);
  });
});
