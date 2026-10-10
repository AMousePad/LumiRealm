import { describe, expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge.js';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';

describe('Risu Lua callback returns', () => {
  for (const waits of [0, 2]) {
    for (const [body, expected] of [
      ['return', null],
      ['return nil', null],
      ["return 'first'", 'first'],
      ["return 'first', 'second'", 'first'],
      ["return nil, 'second'", null],
      ["return 'first', nil", 'first'],
      ["return false, 'second'", false],
      ["return 'first', false", 'first'],
      ["return '', 'second'", ''],
      ["return 0, 'second'", 0],
      ["return id, 'second'", 'safe'],
    ] as const) {
      test(`${body} after ${waits} host awaits`, async () => {
        let calls = 0;
        const result = await execute(`${waits ? 'probe = async(function(id)' : 'function probe(id)'}
          ${'hostValue():await();'.repeat(waits)}
          ${body}
        ${waits ? 'end)' : 'end'}`, { hostValue: async () => { calls++; return 2; } }, { entry: 'probe', args: ['safe'] });
        expect(result).toBe(expected);
        expect(calls).toBe(waits);
      });
    }
  }

  test('an absent callback returns undefined', async () => {
    expect(await execute('local value = 1', {}, { entry: 'absent' })).toBeUndefined();
  });

  test('chunk return values do not enter the callback result stack', async () => {
    expect(await execute(`function probe(id) return id, 'tail' end
      return 'chunk', 'values'`, {}, { entry: 'probe', args: ['safe'] })).toBe('safe');
  });

  for (const [body, stop] of [["return false, 'second'", true], ["return 'first', false", false]] as const) {
    test(`onStart ${body} sets stopSending=${stop}`, async () => {
      const { runtime } = await runTriggerEffects([{
        type: 'triggerlua', code: `function onStart(id) ${body} end`,
      }], {}, { binding: 'start' });
      expect(runtime.stopSending).toBe(stop);
    });
  }
});
