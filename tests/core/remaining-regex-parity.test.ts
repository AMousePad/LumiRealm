import { expect, test } from 'bun:test';
import { translateRisuPreset } from '../../src/core/preset/risup-translator.js';
import { applyPromptRegexToArray, type PrebuiltPipelineInput } from '../../src/interceptors/prompt-regex-apply.js';
import type { LlmMessage } from '../../src/adapters/spindle-extras.js';

const gate = '{{#if {{greater_equal::{{chat_index}}::1}}}}$1:{{getglobalvar::switch}}{{/if}}{{#if {{less::{{chat_index}}::1}}}}old{{/if}}';

test('preset regex keeps CBS and executes comparison gates in each history frame', async () => {
  const { regexScripts } = translateRisuPreset({ name: 'Neutral', regex: [
    { in: '(TOKEN)', out: gate, type: 'editprocess', flag: 'g', ableFlag: true },
  ] });
  const row = regexScripts[0]!;
  expect(row.replace_string).toBe(gate);
  const messages: LlmMessage[] = [
    { role: 'assistant', content: 'TOKEN' },
    { role: 'user', content: 'TOKEN' },
    { role: 'assistant', content: 'TOKEN' },
  ];
  const prebuilt: PrebuiltPipelineInput = {
    phase: 'display', chatId: 'neutral-regex', userName: 'User', charName: 'Character',
    character: {}, chat: { messageCount: 3, lastMessageId: 2 },
    variables: { local: { switch: 'wrong' }, global: { switch: 'enabled' } },
  };
  await applyPromptRegexToArray(messages, prebuilt, [{ ...row, target: 'prompt',
    replace_string: row.replace_string!,
    substitute_macros: row.substitute_macros!, min_depth: null, max_depth: null,
    flags: row.flags!, trim_strings: [], placement: ['user_input', 'ai_output'],
  }]);
  expect(messages.map(m => m.content)).toEqual(['old', 'old', 'TOKEN:enabled']);
});
