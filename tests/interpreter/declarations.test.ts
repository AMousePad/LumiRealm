import { describe, expect, test } from 'bun:test';
import { buildEvaluatorContext } from '../../src/interpreter/evaluator/context.js';
import { runPipeline, type RunPipelineInput } from '../../src/interpreter/evaluator/pipeline.js';
import { evaluate } from '../../src/interpreter/evaluator/scanner.js';
import { createLuaTemplateParser, createTriggerTemplateParser } from '../../src/interpreter/runtime/template.js';
import { parseDisplayCaller } from '../../src/display/caller-parser.js';

const input: RunPipelineInput = {
  template: '', phase: 'display', chatId: '', userName: 'User', charName: 'Character',
  character: {}, chat: {}, variables: {}, reparseMacroResults: false,
};

// Risu declare writes matcherArg.var; ordinary callers leave it null, so matcher retains the macro.
export const declarationCases: readonly (readonly [string, string])[] = [
  ['{{declare::x}}', '{{declare::x}}'],
  ['{{declare}}', '{{declare}}'],
  ['{{declare::}}', '{{declare::}}'],
  ['{{De-clare::x}}', '{{De-clare::x}}'],
  ['{{declare::{{upper::x}}}}', '{{declare::X}}'],
  ['{{declared::x}}', '{{declared::x}}'],
  ['{{declared}}', '{{declared}}'],
  ['{{declare::x}}|{{declared::x}}', '{{declare::x}}|{{declared::x}}'],
  ['{{#func f}}{{declare::x}}{{/func}}{{call::f}}', '{{declare::x}}'],
  ['{{declare::x}}|{{tempvar::__declared_x__}}', '{{declare::x}}|'],
  ['{{settempvar::__declared_x__::saved}}{{declare::x}}|{{tempvar::__declared_x__}}', '{{declare::x}}|saved'],
  ['{{#if 0}}{{declare::x}}{{/if}}end', 'end'],
];

describe('declaration macros without a caller variable map', () => {
  for (const [template, expected] of declarationCases) {
    test(template, () => {
      expect(runPipeline({ ...input, template })).toBe(expected);
      expect(runPipeline({ ...input, template, phase: 'commit', runVar: true })).toBe(expected);
      expect(runPipeline({ ...input, template, rmVar: true })).toBe(expected);
    });
  }

  test('field reparses preserve the declaration without creating a temporary marker', () => {
    expect(runPipeline({ ...input, template: '{{description}}|{{declared::x}}',
      character: { description: '{{declare::x}}' } })).toBe('{{declare::x}}|{{declared::x}}');
  });

  test('sequential evaluations do not establish declaration state', () => {
    const context = buildEvaluatorContext({ ...input, commit: false });
    expect(evaluate('{{declare::x}}', context)).toBe('{{declare::x}}');
    expect(evaluate('{{declared::x}}', context)).toBe('{{declared::x}}');
  });

  test('display, Lua and compiled trigger callers retain the declaration', () => {
    const template = '{{declare::x}}|{{declared::x}}';
    const runtimeInput = { ...input, commit: false };
    expect(parseDisplayCaller({ ...input, template }, { touched: new Set(), volatile: false })).toBe(template);
    expect(createLuaTemplateParser(() => runtimeInput, () => 'null')(template)).toBe(template);
    expect(createTriggerTemplateParser(runtimeInput, () => 'null')(template)).toBe(template);
  });
});
