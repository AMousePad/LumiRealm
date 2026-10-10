import { describe, expect, test } from 'bun:test';
import { makeVarsApi } from '../../../src/interpreter/runtime/vars.js';

test('Risu runTrigger does not mark identical saved values as changed', () => {
  const dirty = { value: false };
  const varsCache = { $count: '2' };
  const vars = makeVarsApi({ varsCache, localScopes: new Map(), dirty, characterId: null });
  vars.setvarV2('count', '=', '2');
  vars.setvarV1('count', '+=', '0');
  expect(dirty.value).toBe(false);
  vars.setvarV2('count', '=', '3');
  vars.setvarV2('count', '=', '3');
  expect(dirty.value).toBe(true);
  expect(varsCache.$count).toBe('3');
});

test('matching a default still creates a saved value, as in Risu runTrigger', () => {
  const dirty = { value: false };
  const varsCache = {};
  const vars = makeVarsApi({ varsCache, scriptstateDefaults: { count: '2' }, localScopes: new Map(), dirty, characterId: null });
  vars.setvarV2('count', '=', '2');
  expect(dirty.value).toBe(true);
  expect(varsCache).toEqual({ $count: '2' });
});

describe('trigger arithmetic matches Risu runTrigger', () => {
  const cases = [
    ['abc', '+=', '1', '1'],
    ['abc', '-=', '2', '-2'],
    ['abc', '*=', '2', '0'],
    ['3', '+=', 'bad', 'NaN'],
    ['3', '-=', 'bad', 'NaN'],
    ['5', '/=', '0', 'Infinity'],
    ['-5', '/=', '0', '-Infinity'],
    ['0', '/=', '0', 'NaN'],
    ['Infinity', '+=', '2', 'Infinity'],
    ['Infinity', '*=', '0', 'NaN'],
    ['2', '=', 'text', 'text'],
    ['2', '+=', '0.5', '2.5'],
  ];
  for (const version of ['setvarV1', 'setvarV2'] as const) {
    test.each(cases)(`${version}: %s %s %s produces %s`, (previous, op, value, expected) => {
      const vars = makeVarsApi({
        varsCache: { $n: previous! }, localScopes: new Map(), dirty: { value: false }, characterId: null,
      });
      vars[version]('n', op!, value);
      expect(vars.getVar('n')).toBe(expected!);
    });
  }
  test.each([['5', '0', 'NaN'], ['abc', '2', '0'], ['-5', '2', '-1']])(
    'V2 remainder: %s %% %s produces %s', (previous, value, expected) => {
      const vars = makeVarsApi({
        varsCache: { $n: previous! }, localScopes: new Map(), dirty: { value: false }, characterId: null,
      });
      vars.setvarV2('n', '%=', value);
      expect(vars.getVar('n')).toBe(expected!);
    },
  );
});
