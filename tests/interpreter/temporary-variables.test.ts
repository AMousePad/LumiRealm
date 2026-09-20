import { expect, test } from 'bun:test';
import { buildEvaluatorContext, evaluate } from '../../src/interpreter/evaluator/index.js';

function context(description = '') {
  return buildEvaluatorContext({
    chatId: '', userName: 'User', charName: 'Character',
    character: { description }, chat: {}, variables: {}, commit: false,
    reparseMacroResults: false,
  });
}

const temporaryCases = [
  ['function reads are isolated', '{{settempvar::x::outer}}{{#func f}}{{tempvar::x}}{{settempvar::x::inner}}{{/func}}{{call::f}}|{{tempvar::x}}', '|outer'],
  ['function returns preserve the caller value', '{{settempvar::__return__::outer}}{{#func f}}{{return::}}{{/func}}{{call::f}}|{{tempvar::__return__}}', '|outer'],
  ['successive calls start empty', '{{#func f}}{{tempvar::x}}{{settempvar::x::inner}}{{/func}}{{call::f}}|{{call::f}}', '|'],
  ['nested calls preserve each frame', '{{#func g}}{{tempvar::x}}{{settempvar::x::nested}}{{/func}}{{#func f}}{{settempvar::x::inner}}{{call::g}}{{tempvar::x}}{{/func}}{{settempvar::x::outer}}{{call::f}}|{{tempvar::x}}', 'inner|outer'],
  ['inline blocks retain their frame', '{{settempvar::x::outer}}{{#if 1}}{{settempvar::x::inner}}{{/if}}{{tempvar::x}}', 'inner'],
  ['omitted values remain undefined', '{{settempvar::__return__}}{{settempvar::__force_return__::1}}after', 'null'],
  ['explicit empty values remain empty', '{{settempvar::__return__::}}{{settempvar::__force_return__::1}}after', ''],
  ['omitted names use the undefined property', '{{settempvar::undefined::value}}{{tempvar}}', 'value'],
  ['omitted names do not use the empty property', '{{settempvar::::value}}{{tempvar}}|{{tempvar::}}', '|value'],
  ['ordinary object prototype reads remain visible', '{{tempvar::hasOwnProperty}}', String(Object.prototype.hasOwnProperty)],
  ['undefined assignment shadows the prototype', '{{settempvar::toString}}{{tempvar::toString}}', ''],
  ['string proto assignment is ignored', '{{settempvar::__proto__::value}}{{tempvar::__proto__}}', '[object Object]'],
] as const;

test.each(temporaryCases)('Risu temporary variables: %s', (_name, template, expected) => {
  expect(evaluate(template, context())).toBe(expected);
});

test.each(['1', '0', 'false', 'null', ' ', 'text'])(
  'a nonempty force-return flag %s halts parsing', flag => {
    expect(evaluate(`before{{settempvar::__return__::value}}{{settempvar::__force_return__::${flag}}}after`, context())).toBe('value');
  },
);

test.each(['', undefined])('a falsy force-return flag %s does not halt parsing', flag => {
  const suffix = flag === undefined ? '' : '::';
  expect(evaluate(`before{{settempvar::__force_return__${suffix}}}after`, context())).toBe('beforeafter');
});

test('separate parser calls reset temporary variables even with the same context', () => {
  const ctx = context();
  expect(evaluate('{{settempvar::x::value}}{{tempvar::x}}', ctx)).toBe('value');
  expect(evaluate('{{tempvar::x}}', ctx)).toBe('');
});

test('field reparses have their own temporary variables', () => {
  const ctx = context('{{tempvar::x}}{{settempvar::x::inner}}');
  expect(evaluate('{{settempvar::x::outer}}{{description}}|{{tempvar::x}}', ctx)).toBe('|outer');
});
