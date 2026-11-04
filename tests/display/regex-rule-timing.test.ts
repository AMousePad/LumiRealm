import { describe, expect, test } from 'bun:test';
import { applyRegexScriptsCore, formatRuleTimings, hasCbsSyntax, type RegexCoreScript } from '../../src/display/regex-core.js';
import { buildEvaluatorContext, evaluate } from '../../src/interpreter/evaluator/index.js';
import { runRegexRequest } from '../../src/regex-runner.js';
import type { PrebuiltPipelineInput } from '../../src/interceptors/prompt-regex-apply.js';

function script(name: string, find: string, replace: string, overrides: Partial<RegexCoreScript> = {}): RegexCoreScript {
  return {
    name, find_regex: find, replace_string: replace, flags: 'g', substitute_macros: 'none',
    placement: ['ai_output'], target: 'display', min_depth: null, max_depth: null, trim_strings: [], ...overrides,
  };
}

const chain = [
  script('first', 'a', 'b'),
  script('second', 'b', 'c{{x}}', { reResolveAfterRule: true }),
  script('skipped', 'c', 'never', { placement: ['user_input'] }),
  script('disabled', 'c', 'never', { disabled: true }),
  script('after', 'c', 'd', { substitute_macros: 'after' }),
  script('invalid', '(', 'never'),
];

describe('per-rule regex timing', () => {
  test('timed and untimed runs produce the same text', () => {
    const opts = { placement: 'ai_output', depth: 0, evalTemplate: (text: string) => text.replace('{{x}}', 'X') };
    const seen: (string | undefined)[] = [];
    const timed = applyRegexScriptsCore('aaa', chain, { ...opts, onRuleTiming: (rule, ms) => {
      expect(ms).toBeGreaterThanOrEqual(0);
      seen.push(rule.name);
    } });
    expect(timed).toBe(applyRegexScriptsCore('aaa', chain, opts));
    expect(seen).toEqual(chain.map((rule) => rule.name));
  });

  test('sorts slowest first and honors the limit', () => {
    expect(formatRuleTimings([['fast', 1], ['slow', 20.5], ['mid', 5]], 2)).toBe('slow=20.5ms, mid=5.0ms');
  });

  test('the runner reports per-rule times only when asked', async () => {
    const base = {
      requestId: 'r', prebuilt: {} as unknown as PrebuiltPipelineInput,
      scripts: [script('one', 'x', 'y', { placement: ['user_input'], target: 'prompt' })],
      messages: [{ role: 'user' as const, content: 'x' }],
    };
    const off = await runRegexRequest(base);
    const on = await runRegexRequest({ ...base, timeRules: true });
    expect(off).not.toHaveProperty('ruleMs');
    expect(on.ok && on.ruleMs?.length).toBe(1);
    expect(on.ok && on.messages).toEqual(off.ok && off.messages);
  });
});

describe('lorebook entries without macro syntax', () => {
  const ctx = buildEvaluatorContext({
    chatId: 'c', userName: 'Alice', charName: 'Bob', character: { description: '', jailbreakPrompt: '' },
    chat: { messageCount: 1, lastMessage: '', lastUserMessage: '', lastCharMessage: '' }, variables: {}, commit: false,
  } as Parameters<typeof buildEvaluatorContext>[0]);

  test('the evaluator returns them unchanged, so skipping it is safe', () => {
    const pieces = ['{', '}', '#', '<', '>', ':', '|', '$', '\\', '\n', ' ', '}}', '#}', 'user', 'char', 'bot', 'if', '한글', '😀', '<b>', '</user>', '< user>', '::', '[[', ']]', '@', '%'];
    let seed = 12345;
    const next = (limit: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % limit; };
    let checked = 0;
    for (let round = 0; round < 20_000; round += 1) {
      let text = '';
      for (let count = next(12); count > 0; count -= 1) text += pieces[next(pieces.length)];
      if (hasCbsSyntax(text)) continue;
      checked += 1;
      expect(evaluate(text, ctx)).toBe(text);
    }
    expect(checked).toBeGreaterThan(5_000);
  });

  test.each(['{{user}}', '{#if 1#}', '<USER>', '<char>', '<bot>'])('%s still counts as macro syntax', (text) => {
    expect(hasCbsSyntax(text)).toBe(true);
  });
});
