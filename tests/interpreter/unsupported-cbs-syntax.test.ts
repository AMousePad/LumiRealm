import { describe, expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';

// Risu's blockStartMatcher and registerCBS(calc), through risuChatParser.
const cases = [
  ['a{{#ignore}}hidden{{/ignore}}b', 'a{{#ignore}}hidden{{/ignore}}b'],
  ['{{#ignore}}A {{char}} B{{/ignore}}', '{{#ignore}}A Character B{{/ignore}}'],
  ['{{#ignore}}{{#ignore}}x{{/ignore}}{{/ignore}}', '{{#ignore}}{{#ignore}}x{{/ignore}}{{/ignore}}'],
  ['{{#ignore}}{{#if 1}}yes{{/if}}{{#if 0}}no{{/if}}{{/ignore}}', '{{#ignore}}yes{{/ignore}}'],
  ['{{#if 0}}{{#ignore}}{{char}}{{/ignore}}{{/if}}', ''],
  ['{{#pure}}{{#ignore}}{{char}}{{/ignore}}{{/pure}}', '{{#ignore}}{{char}}{{/ignore}}'],
  ['{{#ignore}}{{settempvar::x::seen}}{{/ignore}}|{{tempvar::x}}', '{{#ignore}}{{/ignore}}|seen'],
  ['{{#ignore}}open', '{{#ignore}}open'],
  ['close{{/ignore}}', 'close{{/ignore}}'],
  ['{{#ignore::x}}body{{/ignore}}', '{{#ignore::x}}body{{/ignore}}'],
  ['{{#ignore}}{{#each [1,2] as x}}{{slot::x}}{{/each}}{{/ignore}}', '{{#ignore}}12{{/ignore}}'],
  ['{{calc}}', '{{calc}}'],
  ['{{CALC}}', '{{CALC}}'],
  ['{{calc::}}', '0'],
  ['{{calc:}}', '0'],
  ['{{calc::2+3}}', '5'],
  ['{{calc::{{calc}}}}', '0'],
  ['{{#pure}}{{calc}}{{/pure}}', '{{calc}}'],
  ['{{#if 0}}{{calc}}{{/if}}', ''],
  ['{{? }}', '0'],
  ['{{? 2+3}}', '5'],
] as const;

for (const phase of ['display', 'commit'] as const) {
  describe(`unsupported CBS syntax in ${phase}`, () => {
    for (const [template, expected] of cases) {
      test(template, () => {
        expect(runPipeline({
          template, phase, chatId: '', charName: 'Character', userName: 'User',
          cbsContext: true, reparseMacroResults: false,
          variables: { local: {}, global: {} }, character: {}, chat: {},
        })).toBe(expected);
      });
    }
  });
}
