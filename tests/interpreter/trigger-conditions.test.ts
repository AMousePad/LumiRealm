import { expect, test } from 'bun:test';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';
import type { TriggerEffect, TriggerScript } from '../../src/core/schemas/triggerscript.js';

const mark = { type: 'v2SetVar', var: 'ran', operator: '=', value: 'yes', valueType: 'value', indent: 1 };

test.each([
  ['1.0', '=', '1', true], ['1.0', '!=', '1', false], ['', '=', '0', true],
  ['1', '≡', 'true', true], ['0', '≡', 'false', true], ['other', '≡', 'false', true],
  ['other', '≡', 'true', false], ['same', 'unknown', 'same', false],
])('V2 condition %s %s %s has Risu truth value %s', async (source, condition, target, expected) => {
  const { saved } = await runTriggerEffects([
    { type: 'v2IfAdvanced', sourceType: 'value', source, condition, targetType: 'value', target, indent: 0 },
    mark,
    { type: 'v2EndIndent', indent: 1 },
  ] as TriggerEffect[]);
  expect(saved.ran === 'yes').toBe(expected);
});

test.each([
  ['1.0', '=', '1', false], ['hello', 'true', '', false], ['1', 'true', '', true],
  ['', 'null', '', false], ['null', 'null', '', true], ['bad', '>', '1', true],
])('trigger condition %s %s %s keeps its distinct Risu rules', async (source, operator, value, expected) => {
  const { saved } = await runTriggerEffects([{ ...mark, indent: 0 }] as TriggerEffect[], {}, {}, [
    { type: 'value', var: source, operator, value },
  ] as TriggerScript['conditions']);
  expect(saved.ran === 'yes').toBe(expected);
});

const messages = [
  { id: '1', role: 'user', content: 'First' },
  { id: '2', role: 'assistant', content: 'Second\nline' },
];
test.each([
  [{ type: 'chatindex', operator: '=', value: '2' }, true],
  [{ type: 'exists', type2: 'loose', value: 'FIRST', depth: 0 }, true],
  [{ type: 'exists', type2: 'strict', value: 'first', depth: 2 }, false],
  [{ type: 'exists', type2: 'strict', value: 'line', depth: 2 }, false],
  [{ type: 'exists', type2: 'regex', value: '^First Second', depth: 2 }, true],
])('message condition %j follows Risu count and search semantics', async (condition, expected) => {
  const { saved } = await runTriggerEffects([{ ...mark, indent: 0 }] as TriggerEffect[], {}, {
    preloaded: { messagesRaw: messages },
  }, [condition] as TriggerScript['conditions']);
  expect(saved.ran === 'yes').toBe(expected);
});

test('an invalid condition regex throws instead of becoming a text search', async () => {
  await expect(runTriggerEffects([mark] as TriggerEffect[], {}, {}, [
    { type: 'exists', type2: 'regex', value: '[', depth: 1 },
  ] as TriggerScript['conditions'])).rejects.toBeInstanceOf(SyntaxError);
});
