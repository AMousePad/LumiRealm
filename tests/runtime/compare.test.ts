import { expect, test } from 'bun:test';
import { compareValues, compareTriggerCondition } from '../../src/interpreter/runtime/compare.js';

test.each([
  ['a', 'a', '=', true], ['a', 'b', '=', false], ['a', 'b', '!=', true],
  ['5', '3', '>', true], ['3', '5', '<', true], ['5', '5', '>=', true], ['5', '5', '<=', true],
  ['["hello","world"]', 'world', '∋', true], ['["hello"]', 'world', '∋', false],
  ['bad JSON', 'world', '∋', false], ['bad JSON', 'world', '∌', true],
  ['hello', '["hello","world"]', '∈', true], ['missing', '["hello"]', '∉', true],
  ['hello', 'bad JSON', '∈', false], ['hello', 'bad JSON', '∉', true],
  ['Hello world', 'helloworld', '≒', true], ['Hello', 'world', '≒', false],
  ['1.00001', '1', '≒', true], ['1.001', '1', '≒', false],
])('Risu V2 comparison %s %s %s', (a, b, op, expected) => {
  expect(compareValues(a, b, op as string)).toBe(expected);
});

test.each(['==', '≠', '≥', '≤', 'contains', 'in', 'approx', 'truthy', 'null', 'unknown'])(
  'unrecognized V2 operator %s does not take the branch', operator => {
    expect(compareValues('same', 'same', operator)).toBe(false);
  },
);

test.each([
  ['true', 'true', true], ['1', 'true', true], ['value', 'true', false],
  ['null', 'null', true], ['', 'null', false], ['undefined', 'null', false],
])('Risu trigger predicate %s %s', (source, operator, expected) => {
  expect(compareTriggerCondition(source as string, '', operator as string)).toBe(expected);
});
