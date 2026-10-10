import { describe, expect, test } from 'bun:test';
import type { TriggerEffect } from '../../../src/core/schemas/triggerscript.js';
import { calculate } from '../../../src/interpreter/runtime/calc.js';
import { runTriggerEffects } from '../../helpers/trigger-runtime.js';

const calculation = (expression: string, expressionType = 'value', outputVar = 'out'): TriggerEffect => ({
  type: 'v2Calculate', expression, expressionType, outputVar, indent: 0,
});

for (const execution of ['interpreted', 'compiled'] as const) {
  describe(`trigger calculations (${execution})`, () => {
    test.each([
      ['(1+2)*3', '9'], ['2^3^2', '64'], ['2**3', '0'], ['1/0', 'Infinity'],
      ['0/0', 'NaN'], ['foo', '0'], ['()', '0'], ['(1+2', '3'],
      ['1.2.3', '1.2'], ['2<3', '1'], ['0||7', '7'], ['2&&7', '7'],
    ])('matches Risu runTrigger for %s', async (expression, expected) => {
      const { saved } = await runTriggerEffects([calculation(expression!)], {}, {}, [], execution);
      expect(saved.out).toBe(expected);
    });

    test('uses trigger locals before saved values and reads globals from the snapshot', async () => {
      const { saved } = await runTriggerEffects([
        { type: 'v2DeclareLocalVar', var: 'n', value: '4.2units', valueType: 'value', indent: 0 },
        calculation('$n+@global+($missing)+$bad'),
      ], { n: '99', bad: 'word' }, { preloaded: { globalVars: { global: '3suffix' } } }, [], execution);
      expect(saved.out).toBe('7.2');
      expect(saved.n).toBe('99');
    });

    test('resolves expression and destination macros before storing the result', async () => {
      const { saved } = await runTriggerEffects([
        calculation('{{getvar::source}}', 'var', '{{getvar::destination}}'),
      ], { source: 'expression', expression: '$n+2', n: '3', destination: 'answer' }, {}, [], execution);
      expect(saved.answer).toBe('5');
      expect(saved['{{getvar::destination}}']).toBeUndefined();
    });

    test('treats non-value expression types as variable reads', async () => {
      const { saved } = await runTriggerEffects([calculation('expression', 'other')], { expression: '2+3' }, {}, [], execution);
      expect(saved.out).toBe('5');
    });

    test('preserves display-local results without writing saved variables', async () => {
      const { runtime, saved } = await runTriggerEffects([
        calculation('$n+1'),
      ], {}, { displayMode: true, preloaded: { scriptstateDefaults: { n: '5' } } }, [], execution);
      expect(runtime.getVar('out')).toBe('6');
      expect(saved).toEqual({});
    });
  });
}

describe('calculation evaluation order', () => {
  test('substitutes trigger locals before evaluating global variables in parentheses', () => {
    const reads: string[] = [];
    const writes: [string, unknown][] = [];
    calculate({
      resolve: (value) => { reads.push(String(value)); return String(value); },
      getVar: name => { reads.push(`local:${name}`); return '2'; },
      getStoredVar: () => { throw new Error('Trigger variables were not substituted'); },
      setVar: (name, value) => { writes.push([name, value]); },
    }, name => { reads.push(`global:${name}`); return '3'; }, '(@g)+$a+($b)', 'value', 'out');
    expect(reads).toEqual(['(@g)+$a+($b)', 'local:a', 'local:b', 'global:g', 'out']);
    expect(writes).toEqual([['out', '7']]);
  });

  test('writes zero when expression parsing throws', () => {
    const writes: [string, unknown][] = [];
    calculate({
      resolve: (value) => {
        if (value === 'expression') throw new Error('Invalid expression');
        return 'answer';
      },
      getVar: () => '0', getStoredVar: () => '0',
      setVar: (name, value) => { writes.push([name, value]); },
    }, () => '0', 'expression', 'value', 'destination');
    expect(writes).toEqual([['answer', '0']]);
  });

  test('retries the output name in the catch branch and preserves a second failure', () => {
    let attempts = 0;
    const writes: [string, unknown][] = [];
    const vars = {
      resolve: (value: unknown) => {
        if (value !== 'destination') return String(value);
        if (++attempts === 1) throw new Error('First destination attempt');
        return 'answer';
      },
      getVar: () => '0', getStoredVar: () => '0',
      setVar: (name: string, value: unknown) => { writes.push([name, value]); },
    };
    calculate(vars, () => '0', '2+3', 'value', 'destination');
    expect(writes).toEqual([['answer', '0']]);
    expect(attempts).toBe(2);
    vars.resolve = () => { throw new Error('Persistent parser failure'); };
    expect(() => calculate(vars, () => '0', '2+3', 'value', 'destination')).toThrow('Persistent parser failure');
  });
});
