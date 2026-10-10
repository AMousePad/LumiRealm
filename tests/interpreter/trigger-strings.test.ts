import { expect, test } from 'bun:test';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';
import type { TriggerEffect } from '../../src/core/schemas/triggerscript.js';

const extract = {
  type: 'v2ExtractRegex', value: 'ab ab', valueType: 'value', regex: '(a)(b)', regexType: 'value',
  flags: 'g', flagsType: 'value', result: '$2/$1/$123/$<name>', resultType: 'value', outputVar: 'out', indent: 0,
};

test('Risu runTrigger extraction keeps capture groups with the global flag', async () => {
  const { saved } = await runTriggerEffects([extract] as TriggerEffect[]);
  expect(saved.out).toBe('b/a//$<name>');
});

test('extraction without a match keeps the literal parts of its result', async () => {
  const { saved } = await runTriggerEffects([{ ...extract, regex: 'z', result: 'before:$1:$&:$$:after' }] as TriggerEffect[]);
  expect(saved.out).toBe('before:::$:after');
});

test('invalid extraction expressions throw', async () => {
  await expect(runTriggerEffects([{ ...extract, regex: '[' }] as TriggerEffect[])).rejects.toBeInstanceOf(SyntaxError);
});

test('V1 extraction preserves missing captures and fails without a match', async () => {
  const effect = { type: 'extractRegex', value: 'ab', regex: '(a)', flags: '', result: '$2/$&', inputVar: 'out' };
  const { saved } = await runTriggerEffects([effect] as TriggerEffect[], {}, { lowLevelAccess: true });
  expect(saved.out).toBe('undefined/a');
  await expect(runTriggerEffects([{ ...effect, regex: 'z' }] as TriggerEffect[], {}, { lowLevelAccess: true })).rejects.toBeInstanceOf(TypeError);
});

test.each([
  ['$1', 'X', 'Xb'], ['$2', '', 'a'], ['$0', '', ''],
  ['[$2-$1]', 'ignored', '[b-a]'], ['$123', 'X', ''],
])('replacement format %s with %s produces %s', async (result, replacement, expected) => {
  const { saved } = await runTriggerEffects([{
    ...extract, type: 'v2ReplaceString', source: 'ab', sourceType: 'value',
    result, replacement, replacementType: 'value',
  }] as TriggerEffect[]);
  expect(saved.out).toBe(expected);
});

test.each([
  ['a1B2c', '/b/i', ['a1', '2c']], ['a[b', '[', ['a[b']],
])('regex splitting %s by %s follows Risu literal and invalid pattern handling', async (source, delimiter, expected) => {
  const { saved } = await runTriggerEffects([{
    type: 'v2SplitString', source, sourceType: 'value', delimiter, delimiterType: 'regex', outputVar: 'out', indent: 0,
  }] as TriggerEffect[]);
  expect(saved.out).toBe(JSON.stringify(expected));
});

test.each([
  ['a😀b', '1', 'aXb'], ['abc', '5', 'abcX'], ['abc', 'bad', 'abc'], ['abc', '-1', 'abc'],
])('character replacement in %s at %s produces %s', async (source, index, expected) => {
  const { saved } = await runTriggerEffects([{
    type: 'v2SetCharAt', source, sourceType: 'value', index, indexType: 'value',
    value: 'X', valueType: 'value', outputVar: 'out', indent: 0,
  }] as TriggerEffect[]);
  expect(saved.out).toBe(expected);
});
