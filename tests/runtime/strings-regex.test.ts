import { describe, expect, test } from 'bun:test';
import {
  extractRegex,
  regexTest,
  replaceString,
  random,
  setCharAt,
  splitString,
  runRegexEffect,
} from '../../src/interpreter/runtime/strings-regex.js';
import { makeVarsApi } from '../../src/interpreter/runtime/vars.js';

describe('Risu runTrigger regex catch boundaries', () => {
  for (const type of ['v2RegexTest', 'v2ReplaceString']) {
    test(`${type} catches operand template failure`, () => {
      const cache: Record<string, string | null> = {};
      let sourceReads = 0;
      const vars = makeVarsApi({
        varsCache: cache, localScopes: new Map(), dirty: { value: false }, characterId: null,
        parseTemplate: text => {
          if (text === 'pattern') throw new Error('template failure');
          if (text === 'source') return String(++sourceReads);
          return text;
        },
      });
      runRegexEffect(vars, {
        type, outputVar: 'out', value: 'source', valueType: 'value', source: 'source', sourceType: 'value',
        regex: 'pattern', regexType: 'value', result: '$0', resultType: 'value',
        replacement: 'x', replacementType: 'value', flags: '', flagsType: 'value',
      });
      expect(cache.$out).toBe(type === 'v2RegexTest' ? '0' : '2');
      expect(sourceReads).toBe(type === 'v2RegexTest' ? 1 : 2);
    });
  }
});

describe('extractRegex', () => {
  test('invalid patterns fail before evaluating a V2 result template', () => {
    let evaluated = false;
    expect(() => extractRegex('abc', '[', '', () => { evaluated = true; return '$0'; })).toThrow(SyntaxError);
    expect(evaluated).toBe(false);
  });

  test('matches first group + applies template', () => {
    expect(extractRegex('hello world', '(\\w+) (\\w+)', '', '$2-$1')).toBe('world-hello');
  });

  test('no match → empty string', () => {
    expect(extractRegex('hello', '(\\d+)', '', '$1')).toBe('');
  });

  test('invalid extraction regex throws', () => {
    expect(() => extractRegex('x', '(', '', '$0')).toThrow(SyntaxError);
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
    expect(() => regexTest('x', '(', '')).toThrow(SyntaxError);
  });
});

describe('replaceString', () => {
  test('replaces first match without g flag', () => {
    expect(replaceString('hello world', '\\w+', '[match]', '', '')).toBe('[match] world');
  });

  test('replacement is used only when the result selects a capture', () => {
    expect(replaceString('a', 'a', 'OLD', 'NEW', '')).toBe('OLD');
    expect(replaceString('a', 'a', '$0', '', '')).toBe('');
  });

  test('flags g works for multi-replace', () => {
    expect(replaceString('aaa', 'a', '$0', 'b', 'g')).toBe('bbb');
  });

  test('invalid regex → original source', () => {
    expect(() => replaceString('hello', '(', '', '', '')).toThrow(SyntaxError);
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

  test('non-numeric inputs produce NaN', () => {
    expect(random('x', 'y')).toBeNaN();
  });
});

describe('setCharAt', () => {
  test('replaces single char', () => {
    expect(setCharAt('hello', 1, 'a')).toBe('hallo');
  });

  test('an array index past the end appends while a negative index does not', () => {
    expect(setCharAt('abc', 99, 'x')).toBe('abcx');
    expect(setCharAt('abc', -1, 'x')).toBe('abc');
  });

  test('multi-char replacement', () => {
    expect(setCharAt('abc', 1, 'XYZ')).toBe('aXYZc');
  });

  test('non-numeric index leaves the text unchanged', () => {
    expect(setCharAt('abc', 'foo', 'X')).toBe('abc');
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
