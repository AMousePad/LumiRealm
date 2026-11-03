import { expect, test } from 'bun:test';
import { registry } from '../../src/risu-compat/index.js';
import '../../src/risu-compat/handlers/index.js';
import { makeMockContext } from '../helpers/cbs/index.js';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { dateTimeFormat } from '../../src/risu-compat/risu-helpers.js';

for (const name of ['date', 'datetimeformat', 'time']) {
  test(`${name} preserves Risu timestamp scaling and current-clock fallback`, () => {
    const ctx = makeMockContext({ now: 1700000000000 });
    const call = (args: string[]) => registry.get(name)!.handler(ctx, args, '');
    expect(call(['x', '1700000000000'])).toBe('1700000000');
    for (const timestamp of ['', '0', ' ', 'invalid']) expect(call(['x', timestamp])).toBe('1700000000000');
    expect(call(['x'])).toBe('1700000000000');
    expect(call(['x', '-1000'])).toBe('-1');
    expect(call(['x', '1000.9'])).toBe('1');
  });

  test(`${name} reports volatility only when reading the current clock`, () => {
    for (const [suffix, volatile] of [['', true], ['::0', true], ['::invalid', true], ['::1700000000000', false]] as const) {
      const recorder = { touched: new Set<string>(), volatile: false };
      runPipeline({ template: `{{${name}::YYYY${suffix}}}`, phase: 'display', chatId: '',
        userName: '', charName: '', character: {}, chat: {}, variables: {} }, { recorder });
      expect(recorder.volatile).toBe(volatile);
    }
  });

  test(`${name} preserves invalid-date failure even for a literal format`, () => {
    for (const format of ['YYYY', 'literal']) {
      const template = `{{${name}::${format}::Infinity}}`;
      expect(runPipeline({ template, phase: 'display', chatId: '', userName: '', charName: '', character: {}, chat: {}, variables: {} })).toBe(template);
    }
  });
}

test('formatting preserves local English names, repeated tokens and original replacement order', () => {
  const date = new Date(2024, 3, 9, 13, 2, 3);
  expect(dateTimeFormat('YYYY/YY MM DD HH hh mm ss A x X', date.getTime()))
    .toBe(`2024/24 04 09 13 01 02 03 PM ${date.getTime()} ${Math.floor(date.getTime() / 1000)}`);
  expect(dateTimeFormat('MMMM MMMM MMM dddd ddd', date.getTime())).toBe('PMpril PMpril PMpr Tuesday Tue');
  expect(dateTimeFormat(':YYYY', date.getTime())).toBe('2024');
  expect(dateTimeFormat('', Infinity)).toBe('');
  expect(dateTimeFormat('x'.repeat(301), Infinity)).toBe('');
  expect(dateTimeFormat('x', 0, () => 0)).toBe('0');
});
