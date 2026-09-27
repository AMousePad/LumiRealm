import { afterEach, describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime';
import { clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';

afterEach(clearLuaEngines);

async function run(body: string, lowLevelAccess: boolean, empty = false) {
  const host = makeLuaDivergenceHost();
  if (empty) host.preloaded.lorebook.entries = [];
  const runtime = await makeRisuTriggerRuntime(host.api, {}, divergenceLuaScriptNS, {
    binding: 'manual', lowLevelAccess, preloaded: host.preloaded,
  });
  return runtime.runLua(`probe = async(function(id) ${body} end)`, { entry: 'probe' });
}

describe('Lua lore loading access', () => {
  test.each([false, true])('denied loading raises a decoder error, empty=%s', async empty => {
    expect(await run(`local ok,value=pcall(loadLoreBooks,id)
      return tostring(ok)..'|'..tostring(string.find(tostring(value),
        'expected argument of type string, got nil', 1, true) ~= nil)`, false, empty)).toBe('false|true');
  });

  test('enabled access reaches the reader', async () => {
    expect(await run('return type(loadLoreBooks(id))', true)).toBe('table');
  });

  test('the ordinary reader remains available without low-level access', async () => {
    expect(await run('return type(getLoreBooks(id,"Inventory"))', false)).toBe('table');
  });
});
