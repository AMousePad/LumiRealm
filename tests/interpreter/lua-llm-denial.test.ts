import { afterEach, describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';

import { clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';

afterEach(clearLuaEngines);

async function runModelProbe(body: string, lowLevelAccess = false) {
  const host = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime(host.api, {}, divergenceLuaScriptNS, {
    binding: 'start', lowLevelAccess,
  });
  await runtime.runLua(`onStart = async(function(id) ${body} end)`);
  await runtime.flush();
  return { variables: host.metadata.chat_variables, requests: host.generated };
}

describe('Lua model calls with disabled low-level access', () => {
  for (const name of ['LLM', 'axLLM']) {
    test(`${name} exposes the public wrapper decoder error`, async () => {
      const result = await runModelProbe(`
        local ok, value = pcall(${name}, id, {{role='user', content='Prompt'}})
        setChatVar(id, 'ok', tostring(ok))
        setChatVar(id, 'type', type(value))
        setChatVar(id, 'decoderError', tostring(type(value) == 'string' and
          string.find(value, 'expected argument of type string, got nil', 1, true) ~= nil))
      `);
      expect(result.variables).toEqual({ x: '2', ok: 'false', type: 'string', decoderError: 'true' });
      expect(result.requests).toEqual([]);
    });

    test(`${name}Main resolves to nil`, async () => {
      const result = await runModelProbe(`
        local value = ${name}Main(id, '[]'):await()
        setChatVar(id, 'type', type(value))
      `);
      expect(result.variables).toEqual({ x: '2', type: 'nil' });
      expect(result.requests).toEqual([]);
    });
  }

  test('simpleLLM resolves to nil', async () => {
    const result = await runModelProbe(`
      local value = simpleLLM(id, 'Prompt'):await()
      setChatVar(id, 'type', type(value))
    `);
    expect(result.variables).toEqual({ x: '2', type: 'nil' });
    expect(result.requests).toEqual([]);
  });

  test('simpleLLM preserves one returned value', async () => {
    const result = await runModelProbe(`
      setChatVar(id, 'arity', tostring(select('#', simpleLLM(id, 'Prompt'):await())))
    `);
    expect(result.variables).toEqual({ x: '2', arity: '1' });
    expect(result.requests).toEqual([]);
  });

  for (const name of ['LLM', 'axLLM', 'simpleLLM']) {
    test(`${name} still generates with enabled low-level access`, async () => {
      const call = name === 'simpleLLM'
        ? "simpleLLM(id, 'Prompt'):await()"
        : `${name}(id, {{role='user', content='Prompt'}})`;
      const result = await runModelProbe(`
        local value = ${call}
        setChatVar(id, 'successType', type(value.success))
        setChatVar(id, 'success', tostring(value.success))
        setChatVar(id, 'resultType', type(value.result))
        setChatVar(id, 'result', value.result)
      `, true);
      expect(result.variables).toEqual({ x: '2',
        successType: 'boolean', success: 'true', resultType: 'string', result: 'Generated',
      });
      expect(result.requests).toEqual([{ messages: [{ role: 'user', content: 'Prompt' }] }]);
    });
  }
});

for (const name of ['LLMMain', 'axLLMMain']) {
  test.each([false, true])(`${name} parses JSON before checking access=%s`, async lowLevelAccess => {
    const result = await runModelProbe(`
      local ok = pcall(function() ${name}(id, 'invalid JSON'):await() end)
      setChatVar(id, 'ok', tostring(ok))
    `, lowLevelAccess);
    expect(result.variables).toEqual({ x: '2', ok: 'false' });
    expect(result.requests).toEqual([]);
  });
}
