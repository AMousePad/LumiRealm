import { describe, expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge.js';

describe('Lua Promise.all', () => {
  test('awaits host promises in input order and accepts resolved and plain values', async () => {
    const completed: string[] = [];
    const result = await execute(`
probe = async(function()
  local first = work('first')
  local second = work('second')
  return Promise.all({first, second, Promise.resolve('third'), false}):await()
end)`, {
      work: async (value: unknown) => {
        if (value === 'first') await new Promise(resolve => setTimeout(resolve, 5));
        completed.push(String(value));
        return value;
      },
    }, { entry: 'probe' });
    expect(completed).toEqual(['second', 'first']);
    expect(result).toEqual(['first', 'second', 'third', false]);
  });

  test('uses the native Promise.all array contract', async () => {
    expect(await execute(`
probe = async(function()
  local worker = async(function(value) return value end)
  local ok, err = pcall(function() return Promise.all({}):await() end)
  local values = Promise.all({worker('one'), worker('two')}):await()
  return {ok, tostring(err), values[1], values[2]}
end)`, {}, { entry: 'probe' })).toEqual([false, 'Error: argument must be an array of promises', 'one', 'two']);
  });

  test('propagates rejected workers through the aggregate await', async () => {
    await expect(execute(`
probe = async(function()
  return Promise.all({Promise.resolve('ok'), Promise.create(function(resolve, reject) reject('worker failed') end)}):await()
end)`, {}, { entry: 'probe' })).rejects.toThrow('worker failed');
  });
});
