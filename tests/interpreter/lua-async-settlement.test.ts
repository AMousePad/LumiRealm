import { afterEach, describe, expect, test } from 'bun:test';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';

afterEach(clearLuaEngines);

describe('Lua async callback settlement', () => {
  for (const waits of [0, 2]) {
    for (const [body, expected] of [
      ['return', null], ['return nil', null], ['return false', false],
      ['return true', true], ['return 0', 0], ["return ''", ''],
      ["return 'first', 'second'", 'first'], ["return nil, 'second'", null],
      ["return false, 'second'", false],
    ] as const) {
      test(`${body} after ${waits} host awaits`, async () => {
        let calls = 0;
        const result = await execute(`onStart = async(function(id)
          ${'hostValue():await();'.repeat(waits)} ${body}
        end)`, { hostValue: async () => { calls++; return 'value'; } }, { entry: 'onStart', args: ['safe'] });
        expect(result).toBe(expected);
        expect(calls).toBe(waits);
      });
    }
  }

  for (const body of [
    'return async(function() return false end)()',
    'return Promise.resolve(false)',
    'return hostValue()',
  ]) {
    test(body, async () => {
      expect(await execute(`function onStart(id) ${body} end`, {
        hostValue: async () => false,
      }, { entry: 'onStart', args: ['safe'] })).toBe(false);
    });
  }

  test('ordinary tables with promise-like fields stay ordinary results', async () => {
    const result = await execute(`function onStart(id)
      return {__risu_failed=false,__risu_n=1,__risu_results={false},await=function()return false end}
    end`, {}, { entry: 'onStart', args: ['safe'] });
    expect(result).toMatchObject({ __risu_failed: false, __risu_n: 1, __risu_results: [false] });
  });

  test('uncaught errors inside async callbacks reject execution', async () => {
    await expect(execute(`onStart=async(function(id) error('callback failed') end)`, {}, {
      entry: 'onStart', args: ['safe'],
    })).rejects.toThrow('callback failed');
  });

  test('rejected host promises remain loud inside async callbacks', async () => {
    await expect(execute(`onStart=async(function(id) hostValue():await() end)`, {
      hostValue: async () => { throw new Error('host failed'); },
    }, { entry: 'onStart', args: ['safe'] })).rejects.toThrow('host failed');
  });

  for (const [body, stop] of [['return false', true], ['return true', false], ['return nil', false]] as const) {
    test(`async onStart ${body} sets stopSending=${stop}`, async () => {
      const { runtime } = await runTriggerEffects([{
        type: 'triggerlua', code: `onStart = async(function(id) ${body} end)`,
      }], {}, { binding: 'start' });
      expect(runtime.stopSending).toBe(stop);
    });
  }
});
