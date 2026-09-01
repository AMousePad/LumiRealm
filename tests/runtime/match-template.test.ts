import { describe, expect, test } from 'bun:test';
import { applyMatchTemplate } from '../../src/interpreter/runtime/match-template.js';

function rxMatch(input: string, pattern: RegExp): RegExpMatchArray | null {
  return input.match(pattern);
}

describe('applyMatchTemplate', () => {
  test('null match → returns template verbatim', () => {
    expect(applyMatchTemplate('out: $1', null)).toBe('out: $1');
  });

  test('$&  → full match', () => {
    const m = rxMatch('abc', /b/);
    expect(applyMatchTemplate('[$&]', m)).toBe('[b]');
  });

  test('$$ → literal $', () => {
    const m = rxMatch('abc', /b/);
    expect(applyMatchTemplate('$$', m)).toBe('$');
  });

  test('single-digit captures', () => {
    const m = rxMatch('hello world', /(\w+) (\w+)/);
    expect(applyMatchTemplate('$2 $1', m)).toBe('world hello');
  });

  test('two-digit captures: NN >= 10 only valid if capture exists', () => {
    // 11-capture regex
    const m = rxMatch('a1b2c3d4e5f6g7h8i9j0k1', /(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)/);
    // groups[1..12] = ['a','1','b','2','c','3','d','4','e','5','f','6']
    expect(applyMatchTemplate('$12', m)).toBe('6');
  });

  test('two-digit captures: NN > capture count → fall back to single-digit + literal', () => {
    // 5-capture regex — $15 should be group[1] + literal "5"
    const m = rxMatch('abcde', /(.)(.)(.)(.)(.)/);
    // 5 groups → max two-digit valid is 5; "$15" has NN=15 invalid, fall back
    expect(applyMatchTemplate('$15', m)).toBe('a5');
  });

  test('two-digit zero-pad: $01 reads group[1]', () => {
    const m = rxMatch('abc', /(.)(.)(.)/);
    // Two-digit greedy: 01 in [1, 3] range → group[1]
    expect(applyMatchTemplate('$01', m)).toBe('a');
  });

  test('named capture $<name>', () => {
    const m = rxMatch('hello', /(?<word>\w+)/);
    expect(applyMatchTemplate('[$<word>]', m)).toBe('[hello]');
  });

  test('named capture missing group → empty', () => {
    const m = rxMatch('hello', /(?<word>\w+)/);
    expect(applyMatchTemplate('[$<missing>]', m)).toBe('[]');
  });

  test('$N with N out of range → empty', () => {
    const m = rxMatch('abc', /(.)/);
    // group[2] doesn't exist
    expect(applyMatchTemplate('$2', m)).toBe('');
  });

  test('literal text passthrough', () => {
    const m = rxMatch('abc', /b/);
    expect(applyMatchTemplate('plain text $$ $&', m)).toBe('plain text $ b');
  });
});
