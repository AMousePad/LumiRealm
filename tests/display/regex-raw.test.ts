import { expect, test } from 'bun:test';
import { applyRegexScriptsCore, type RegexCoreScript } from '../../src/display/regex-core.js';

function apply(content: string, pattern: string, flags: string) {
  const script: RegexCoreScript = {
    find_regex: pattern, flags, replace_string: '<$&>', substitute_macros: 'raw',
    placement: ['ai_output'], target: 'display', trim_strings: [], min_depth: null, max_depth: null,
  };
  const replacements: string[] = [];
  const output = applyRegexScriptsCore(content, [script], {
    placement: 'ai_output', depth: 0,
    evalTemplate: (text) => { if (text.startsWith('<')) replacements.push(text); return text; },
  });
  return { output, replacements };
}

test('raw sticky replacement without actions retains native non-global match count', () => {
  expect(apply('xx', 'x', 'y')).toEqual({ output: '<x>x', replacements: ['<x>'] });
});

test('raw Unicode empty matches without actions advance by code point', () => {
  expect(apply('🚀', '(?:)', 'gu')).toEqual({ output: '<>🚀<>', replacements: ['<>', '<>'] });
});

test('raw replacements without actions evaluate captures once per match in order', () => {
  expect(apply('a b', '\\w', 'g')).toEqual({ output: '<a> <b>', replacements: ['<a>', '<b>'] });
});
