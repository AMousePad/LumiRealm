import { expect, test } from 'bun:test';
import { runTriggerEffects } from '../../helpers/trigger-runtime.js';

for (const execution of ['interpreted', 'compiled'] as const) {
  test(`${execution} preserves Risu random bounds, invalid results, and draw order`, async () => {
    const cases = [
      ['bad', '2', 'NaN'], ['1', 'bad', 'NaN'], ['Infinity', 'Infinity', 'NaN'],
      ['5', '5', '5'], ['1.25', '1.25', '1'], ['-2.5', '-2.5', '-3'],
      ['3', '1', '2'], ['-3', '-1', '-3'], ['', '2', '0'],
      ['1', '3', '1'], ['1', '3', '3'],
    ];
    const original = Math.random;
    let draws = 0;
    try {
      Math.random = () => ++draws === cases.length ? 0.999999 : 0.125;
      const { saved } = await runTriggerEffects(cases.map(([min, max], index) => ({
        type: 'v2Random', min: min!, max: max!, minType: 'value', maxType: 'value',
        outputVar: 'out' + index, indent: 0,
      })), {}, {}, [], execution);
      expect(cases.map((_, index) => saved['out' + index])).toEqual(cases.map(row => row[2]));
      expect(draws).toBe(cases.length);
    } finally { Math.random = original; }
  });

  test(`${execution} resolves variable and macro bounds before the draw`, async () => {
    const original = Math.random;
    try {
      Math.random = () => 0.5;
      const { saved } = await runTriggerEffects([{
        type: 'v2Random', min: 'lower', minType: 'var', max: '{{getvar::upper}}', maxType: 'value',
        outputVar: 'out', indent: 0,
      }], { lower: '2', upper: '4' }, {}, [], execution);
      expect(saved.out).toBe('3');
    } finally { Math.random = original; }
  });
}
