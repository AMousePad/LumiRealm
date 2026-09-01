import { describe, expect, test } from 'bun:test';
import {
  extractRegex,
  regexTest,
  replaceString,
  random,
  setCharAt,
  calculate,
  splitString,
} from '../../src/interpreter/runtime/strings-regex.js';

describe('extractRegex', () => {
  test('matches first group + applies template', () => {
    expect(extractRegex('hello world', '(\\w+) (\\w+)', '', '$2-$1')).toBe('world-hello');
  });

  test('no match → empty string', () => {
    expect(extractRegex('hello', '(\\d+)', '', '$1')).toBe('');
  });

  test('invalid regex → empty string (no throw)', () => {
    expect(extractRegex('x', '(', '', '$0')).toBe('');
  });

  test('empty result template still triggers match', () => {
    expect(extractRegex('hello', 'h', '', '')).toBe('');
  });
});

describe('regexTest', () => {
  test('matches → true', () => {
    expect(regexTest('hello', 'lo$', '')).toBe(true);
  });

  test('no match → false', () => {
    expect(regexTest('hello', '\\d', '')).toBe(false);
  });

  test('flags work', () => {
    expect(regexTest('HELLO', 'hello', 'i')).toBe(true);
    expect(regexTest('HELLO', 'hello', '')).toBe(false);
  });

  test('invalid regex → false', () => {
    expect(regexTest('x', '(', '')).toBe(false);
  });
});

describe('replaceString', () => {
  test('replaces first match without g flag', () => {
    expect(replaceString('hello world', '\\w+', '[match]', '', '')).toBe('[match] world');
  });

  test('replacement param wins over result param', () => {
    expect(replaceString('a', 'a', 'OLD', 'NEW', '')).toBe('NEW');
    expect(replaceString('a', 'a', 'OLD', '', '')).toBe('OLD'); // empty replacement falls through
  });

  test('flags g works for multi-replace', () => {
    expect(replaceString('aaa', 'a', '', 'b', 'g')).toBe('bbb');
  });

  test('invalid regex → original source', () => {
    expect(replaceString('hello', '(', '', '', '')).toBe('hello');
  });
});

describe('random', () => {
  test('a == b → returns a', () => {
    expect(random(5, 5)).toBe(5);
  });

  test('inclusive range', () => {
    for (let i = 0; i < 100; i++) {
      const r = random(1, 3);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(3);
    }
  });

  test('non-numeric inputs → 0', () => {
    expect(random('x', 'y')).toBe(0);
  });
});

describe('setCharAt', () => {
  test('replaces single char', () => {
    expect(setCharAt('hello', 1, 'a')).toBe('hallo');
  });

  test('out-of-range index → unchanged', () => {
    expect(setCharAt('abc', 99, 'x')).toBe('abc');
    expect(setCharAt('abc', -1, 'x')).toBe('abc');
  });

  test('multi-char replacement', () => {
    expect(setCharAt('abc', 1, 'XYZ')).toBe('aXYZc');
  });

  test('non-numeric index treated as 0', () => {
    expect(setCharAt('abc', 'foo', 'X')).toBe('Xbc');
  });
});

describe('calculate', () => {
  test('arithmetic delegates to calcString', () => {
    expect(calculate('1+2')).toBe('3');
    expect(calculate('10/2')).toBe('5');
  });

  test('non-arithmetic → NaN', () => {
    expect(calculate('foo')).toBe('NaN');
  });

  test('coerces non-string input', () => {
    expect(calculate(42)).toBe('42');
  });
});

describe('splitString', () => {
  test('plain delimiter split', () => {
    expect(splitString('a,b,c', ',')).toEqual(['a', 'b', 'c']);
  });

  test('regex delimiter when kind=regex', () => {
    expect(splitString('a1b2c', '\\d', 'regex')).toEqual(['a', 'b', 'c']);
  });

  test('non-regex when kind absent — literal string match', () => {
    // Without kind=regex, '\\d' is the literal 2-char string '\d'.
    // 'a\db'.split('\d') splits ON the literal sequence.
    expect(splitString('a\\db', '\\d')).toEqual(['a', 'b']);
    // Same delimiter against text WITHOUT a literal `\d` → single element.
    expect(splitString('abc', '\\d')).toEqual(['abc']);
  });

  test('empty source → ["" ]', () => {
    expect(splitString('', ',')).toEqual(['']);
  });
});
