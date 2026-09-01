import { describe, expect, test } from 'bun:test';
import { compareValues } from '../../src/interpreter/runtime/compare.js';

describe('compareValues', () => {
  test('=, ==', () => {
    expect(compareValues('a', 'a', '=')).toBe(true);
    expect(compareValues('a', 'a', '==')).toBe(true);
    expect(compareValues('a', 'b', '=')).toBe(false);
    // String coercion: 1 vs "1" compares equal (toStr both)
    expect(compareValues(1, '1', '==')).toBe(true);
  });

  test('!=, ≠', () => {
    expect(compareValues('a', 'b', '!=')).toBe(true);
    expect(compareValues('a', 'b', '≠')).toBe(true);
    expect(compareValues('a', 'a', '!=')).toBe(false);
  });

  test('numeric > < >= <=', () => {
    expect(compareValues(5, 3, '>')).toBe(true);
    expect(compareValues(3, 5, '<')).toBe(true);
    expect(compareValues(5, 5, '>=')).toBe(true);
    expect(compareValues(5, 5, '≥')).toBe(true);
    expect(compareValues(5, 5, '<=')).toBe(true);
    expect(compareValues(5, 5, '≤')).toBe(true);
    // String numerics coerce
    expect(compareValues('10', '2', '>')).toBe(true);
  });

  test('null', () => {
    expect(compareValues('', '', 'null')).toBe(true);
    expect(compareValues('null', '', 'null')).toBe(true);
    expect(compareValues('undefined', '', 'null')).toBe(true);
    expect(compareValues(null, '', 'null')).toBe(true);
    expect(compareValues(undefined, '', 'null')).toBe(true);
    expect(compareValues('value', '', 'null')).toBe(false);
    expect(compareValues('0', '', 'null')).toBe(false);
  });

  test('truthy', () => {
    expect(compareValues('value', '', 'truthy')).toBe(true);
    expect(compareValues('value', '', 'true')).toBe(true);
    // Risu's specific falsy set
    expect(compareValues('', '', 'truthy')).toBe(false);
    expect(compareValues('0', '', 'truthy')).toBe(false);
    expect(compareValues('false', '', 'truthy')).toBe(false);
    expect(compareValues('null', '', 'truthy')).toBe(false);
    expect(compareValues('undefined', '', 'truthy')).toBe(false);
  });

  test('contains / notcontains: JSON array membership (Risu v2IfAdvanced)', () => {
    expect(compareValues('["hello","world"]', 'world', 'contains')).toBe(true);
    expect(compareValues('["hello","world"]', 'world', '∋')).toBe(true);
    expect(compareValues('["hello","world"]', 'xyz', 'contains')).toBe(false);
    // Non-JSON source is not substring-matched, it fails the parse.
    expect(compareValues('hello world', 'world', 'contains')).toBe(false);
    expect(compareValues('["hello","world"]', 'xyz', 'notcontains')).toBe(true);
    expect(compareValues('["hello","world"]', 'xyz', '∌')).toBe(true);
    expect(compareValues('hello world', 'world', 'notcontains')).toBe(true);
  });

  test('in / notin: membership in the parsed right-hand array', () => {
    expect(compareValues('ack', '["ack","stack"]', 'in')).toBe(true);
    expect(compareValues('ack', '["ack","stack"]', '∈')).toBe(true);
    expect(compareValues('ack', 'haystack', 'in')).toBe(false);
    expect(compareValues('xyz', '["ack","stack"]', 'notin')).toBe(true);
    expect(compareValues('xyz', '["ack","stack"]', '∉')).toBe(true);
    expect(compareValues('xyz', 'haystack', 'notin')).toBe(true);
  });

  test('approx — case-insensitive equal', () => {
    expect(compareValues('Hello', 'hello', 'approx')).toBe(true);
    expect(compareValues('Hello', 'hello', '≒')).toBe(true);
    expect(compareValues('Hello', 'world', 'approx')).toBe(false);
  });

  test('default falls through to strict equal', () => {
    expect(compareValues('a', 'a', 'unknown-op')).toBe(true);
    expect(compareValues('a', 'b', 'unknown-op')).toBe(false);
  });
});
