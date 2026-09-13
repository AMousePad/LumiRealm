import { describe, expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge.js';

describe('Lua Promise.all', () => {
  test('awaits host promises in input order and accepts resolved and plain values', async () => {
    const completed: string[] = [];
    const result = await execute(`
function probe()
  local first = work('first')
  local second = work('second')
  return Promise.all({first, second, Promise.resolve('third'), false}):await()
end`, {
      work: async (value: unknown) => {
        if (value === 'first') await new Promise(resolve => setTimeout(resolve, 5));
        completed.push(String(value));
        return value;
      },
    }, { entry: 'probe' });
    expect(completed).toEqual(['second', 'first']);
    expect(result).toEqual(['first', 'second', 'third', false]);
  });

  test('handles empty input and async workers', async () => {
    expect(await execute(`
function probe()
  local worker = async(function(value) return value end)
  local empty = Promise.all({}):await()
  local values = Promise.all({worker('one'), worker('two')}):await()
  return {#empty, values[1], values[2]}
end`, {}, { entry: 'probe' })).toEqual([0, 'one', 'two']);
  });

  test('propagates rejected workers through the aggregate await', async () => {
    await expect(execute(`
function probe()
  return Promise.all({Promise.resolve('ok'), Promise.reject('worker failed')}):await()
end`, {}, { entry: 'probe' })).rejects.toThrow('worker failed');
  });
});
