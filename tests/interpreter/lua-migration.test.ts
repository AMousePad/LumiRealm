import { expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { runListenEditChain } from '../../src/interpreter/listen-edit.js';
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';

test('synchronous CBS and identity APIs work at chunk scope and inside table.sort', async () => {
  const host = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime(host.api, { characterId: 'test-character' }, divergenceLuaScriptNS, {
    characterId: 'test-character', templateContext: basicTriggerContext,
  });
  expect(await runtime.runLua(`
    local initial = cbs('{{char}}')
    function probe(id)
      local values = {'b', 'a'}
      table.sort(values, function(a, b) return cbs(a) < cbs(b) end)
      setName(id, 'Renamed')
      return initial..'|'..table.concat(values)..'|'..getName(id)..'|'..cbs('{{char}}')
    end
  `, { entry: 'probe' })).toBe('Character|ab|Renamed|Renamed');
  await runtime.flush();
  expect(host.character.name).toBe('Renamed');
});

test('synchronous setter persistence failures reject flush', async () => {
  const host = makeLuaDivergenceHost();
  host.api.characters.update = async () => { throw new Error('Rejected character write'); };
  const runtime = await makeRisuTriggerRuntime(host.api, { characterId: 'test-character' }, divergenceLuaScriptNS);
  expect(await runtime.runLua('function probe(id) setName(id,"changed"); return getName(id) end', { entry: 'probe' })).toBe('changed');
  await expect(runtime.flush()).rejects.toThrow('Rejected character write');
});

test('a chunk abort preserves writes made with a retained display key', async () => {
  const host = makeLuaDivergenceHost();
  const first = await makeRisuTriggerRuntime(host.api, {}, divergenceLuaScriptNS);
  await first.runLua(`function probe(id) setChatVar(id, 'savedKey', id) end`, {
    entry: 'probe', mode: 'editDisplay',
  });
  await first.flush();
  const second = await makeRisuTriggerRuntime(host.api, {}, divergenceLuaScriptNS);
  await expect(second.runLua(`
    setChatVar(getChatVar('', 'savedKey'), 'beforeError', '1')
    error('chunk abort')
  `, { entry: 'probe' })).rejects.toThrow('chunk abort');
  expect(host.metadata.chat_variables).toMatchObject({ beforeError: '1' });
});

test.each([false, 0, '', 'not JSON'])('Risu edit callbacks retain overridden callListenMain result %j', async value => {
  const host = makeLuaDivergenceHost();
  const result = await runListenEditChain<unknown>([{ source: { effect: [{ type: 'triggerlua' }] },
    luaCode: `function callListenMain() return ${JSON.stringify(value)} end`,
  }], 'editOutput', 'original', {}, host.api, {}, divergenceLuaScriptNS, { preloaded: host.preloaded });
  expect(result).toBe(value);
});

test('writes before a chunk failure survive while later chunks do not run', async () => {
  const host = makeLuaDivergenceHost();
  const codes = [
    `listenEdit('editOutput', function(id, value) setChatVar(id, 'early', '1'); return 'changed' end)`,
    'error("chunk failure")',
    `listenEdit('editOutput', function(id, value) setChatVar(id, 'late', '1'); return value end)`,
  ];
  expect(await runListenEditChain(codes.map(luaCode => ({ source: { effect: [{ type: 'triggerlua' }] }, luaCode })),
    'editOutput', 'original', {}, host.api, {}, divergenceLuaScriptNS, { preloaded: host.preloaded })).toBe('original');
  expect(host.metadata.chat_variables).toEqual({ x: '2', early: '1' });
});

test('an empty chunk resets the mode engine rather than reusing the preceding listeners', async () => {
  const host = makeLuaDivergenceHost();
  const code = `count = 0; listenEdit('editOutput', function(id, value) count = count + 1; return value..count end)`;
  expect(await runListenEditChain([code, '', code].map(luaCode => ({ source: { effect: [{ type: 'triggerlua' }] }, luaCode })),
    'editOutput', '', {}, host.api, {}, divergenceLuaScriptNS, { preloaded: host.preloaded })).toBe('11');
});
