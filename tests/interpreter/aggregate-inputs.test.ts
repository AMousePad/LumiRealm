import { describe, expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { parseDisplayCaller } from '../../src/display/caller-parser.js';
import { createLuaTemplateParser } from '../../src/interpreter/runtime/template.js';

const input = { template: '', phase: 'display' as const, reparseMacroResults: false,
  chatId: '', userName: 'User', charName: 'Character', character: {}, chat: {}, variables: {} };
const names = ['min', 'max', 'sum', 'average', 'all', 'any'];
// Risu passes parsed JSON values directly to Number or strict string comparison.
const cases: readonly (readonly [string, readonly string[]])[] = [
  ['', ['0', '0', '0', '0', '0', '0']],
  ['[]', ['Infinity', '-Infinity', '0', 'NaN', '1', '0']],
  ['[true]', ['1', '1', '1', '1', '0', '0']],
  ['[true,false,2]', ['0', '2', '3', '1', '0', '0']],
  ['[1]', ['1', '1', '1', '1', '0', '0']],
  ['["1"]', ['1', '1', '1', '1', '1', '1']],
  ['[1,"1"]', ['1', '1', '2', '1', '0', '1']],
  ['[null]', ['0', '0', '0', '0', '0', '0']],
  ['[null,"1"]', ['0', '1', '1', '0.5', '0', '1']],
  ['[["1"]]', ['1', '1', '1', '1', '0', '0']],
  ['[[],[1],"2"]', ['0', '2', '3', '1', '0', '0']],
  ['[{}]', ['0', '0', '0', '0', '0', '0']],
  ['[true', ['0', '0', '0', '0', '0', '0']],
  ['true', ['0', '0', '0', '0', '0', '0']],
  ['"1"', ['0', '0', '0', '0', '0', '0']],
  ['[true]::1', ['0', '1', '1', '0.5', '0', '1']],
  ['1§1', ['1', '1', '2', '1', '1', '1']],
  ['true::1', ['0', '1', '1', '0.5', '0', '1']],
  ['{{makearray::1::1}}', ['1', '1', '2', '1', '1', '1']],
];
const callers = {
  pipeline: (template: string) => runPipeline({ ...input, template }),
  display: (template: string) => parseDisplayCaller({ ...input, template }, { touched: new Set(), volatile: false }),
  lua: createLuaTemplateParser(() => ({ ...input, commit: false }), () => 'null'),
};

describe('aggregate input values', () => {
  for (const [caller, evaluate] of Object.entries(callers)) {
    for (const [index, name] of names.entries()) {
      test(`${caller}: omitted ${name} stays literal`, () => {
        expect(evaluate(`{{${name}}}`)).toBe(`{{${name}}}`);
      });
      test(`${caller}: ${name} preserves native object conversion failure`, () => {
        const template = `{{${name}::[{"toString":null}]}}`;
        expect(evaluate(template)).toBe(index < 4 ? template : '0');
      });
      for (const [value, expected] of cases) test(`${caller}: ${name} ${value}`, () => {
        expect(evaluate(`{{${name}::${value}}}`)).toBe(expected[index]!);
      });
    }
  }
});
