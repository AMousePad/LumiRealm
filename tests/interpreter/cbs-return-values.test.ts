import { expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { applyPromptRegexToArray } from '../../src/interceptors/prompt-regex-apply.js';
import { parseDisplayCaller } from '../../src/display/caller-parser.js';

const input = { phase: 'display' as const, chatId: '', userName: 'User', charName: 'Character',
  character: { description: '{{getvar::nested}}' }, chat: {}, variables: { local: {
    nested: '{{char}}', nested2: '{{getvar::nested}}',
  } }, cbsContext: true };

test.each([
  ['{{description}}', '{{char}}'],
  ['{{upper::{{getvar::nested}}}}', '{{CHAR}}'],
  ['{{#func f}}{{getvar::nested}}{{/func}}{{call::f}}', '{{char}}'],
])('Risu parses explicit source structure without expanding returned text: %s', (template, expected) => {
  expect(runPipeline({ ...input, template })).toBe(expected);
});

test('prompt regex replacement gets one Risu parser pass', async () => {
  const messages = [{ role: 'user' as const, content: 'TOKEN' }];
  await applyPromptRegexToArray(messages, { ...input, phase: 'commit', suppressVarPersist: true }, [{
    find_regex: 'TOKEN', replace_string: '{{getvar::nested2}}', flags: 'g', substitute_macros: 'none',
    placement: ['user_input'], target: 'prompt', min_depth: null, max_depth: null, trim_strings: [], disabled: false,
  }]);
  expect(messages[0]!.content).toBe('{{getvar::nested}}');
});

test('display keeps its explicit caller and post-script parser passes', () => {
  const first = parseDisplayCaller({ ...input, template: '{{getvar::nested2}}', rmVar: true }, { touched: new Set(), volatile: false });
  expect(first).toBe('{{getvar::nested}}');
  expect(runPipeline({ ...input, template: first })).toBe('{{char}}');
});

test('native host result expansion remains an explicit caller option', () => {
  const native = { ...input, template: '{{char}}', charName: '{{user}}' };
  expect(runPipeline(native)).toBe('{{user}}');
  expect(runPipeline({ ...native, reparseMacroResults: true })).toBe('User');
});
