import { describe, expect, test } from 'bun:test';
import type { TriggerEffect } from '../../../src/core/schemas/triggerscript.js';
import type { HostMessage } from '../../../src/interpreter/host.js';
import { runTriggerEffects } from '../../helpers/trigger-runtime.js';

const greeting: HostMessage = { id: 'greeting', role: 'assistant', content: 'Greeting' };
const messages: HostMessage[] = [
  { id: 'first', role: 'user', content: 'One\tTwo' },
  { id: 'second', role: 'assistant', content: 'THREE' },
  { id: 'third', role: 'user', content: 'Four\nFive' },
];

for (const execution of ['interpreted', 'compiled'] as const) {
  describe(`${execution} structured message reads match Risu runTrigger`, () => {
    const run = async (effect: TriggerEffect, rows = messages) => {
      const result = await runTriggerEffects([effect], {}, {
        preloaded: { messagesRaw: [greeting, ...rows] },
      }, [], execution);
      return result.saved['out'];
    };

    for (const type of ['v2GetLastMessage', 'v2GetLastUserMessage', 'v2GetLastCharMessage'] as const) {
      test(`${type} reports missing messages without returning the greeting`, async () => {
        expect(await run({ type, outputVar: 'out', indent: 0 }, [])).toBe('null');
      });
      test(`${type} preserves empty content and the literal null string`, async () => {
        const role = type === 'v2GetLastCharMessage' ? 'assistant' : 'user';
        for (const content of ['', 'null']) {
          const rows = [{ id: 'value', role, content }, { id: 'last', role: 'system', content: 'tail' }];
          const selected = type === 'v2GetLastMessage' ? rows.slice(0, 1) : rows;
          expect(await run({ type, outputVar: 'out', indent: 0 }, selected)).toBe(content);
        }
      });
    }

    for (const [index, expected] of [
      ['0', 'One\tTwo'], ['1', 'THREE'], ['2', 'Four\nFive'],
      ['-1', 'null'], ['-3', 'null'], ['3', 'null'], ['1.5', 'null'],
      ['bad', 'null'], ['Infinity', 'null'], ['-0', 'One\tTwo'], ['', 'One\tTwo'],
    ] as const) {
      test(`structured index ${JSON.stringify(index)} uses array-property access`, async () => {
        expect(await run({ type: 'v2GetMessageAtIndex', index, indexType: 'value', outputVar: 'out', indent: 0 })).toBe(expected);
      });
    }

    for (const [value, condition, depth, expected] of [
      ['THREE', 'strict', '3', '1'], ['three', 'strict', '3', '0'],
      ['One', 'strict', '3', '0'], ['One\tTwo', 'strict', '3', '1'],
      ['Four\nFive', 'strict', '3', '1'], ['Five', 'strict', '3', '0'],
      ['two three', 'loose', '3', '1'], ['^One\\tTwo THREE Four\\nFive$', 'regex', '3', '1'],
      ['three', 'regex', '3', '0'], ['THREE', 'regex', '3', '1'],
      ['One', 'loose', '0', '1'], ['One', 'loose', '-1', '0'],
      ['THREE', 'strict', '-1', '1'], ['THREE', 'strict', '1.9', '0'],
      ['THREE', 'strict', '2.1', '1'], ['One', 'loose', 'Infinity', '1'],
      ['One', 'loose', '-Infinity', '0'], ['Four', 'loose', 'bad', '0'],
      ['Four', 'loose', '1', '1'], ['One', 'loose', '1', '0'],
    ] as const) {
      test(`${condition} search ${JSON.stringify(value)} at depth ${depth}`, async () => {
        expect(await run({ type: 'v2QuickSearchChat', value, valueType: 'value', condition, depth, depthType: 'value', outputVar: 'out', indent: 0 })).toBe(expected);
      });
    }

    test('invalid search regex aborts instead of falling back to a literal search', async () => {
      await expect(run({ type: 'v2QuickSearchChat', value: '[', valueType: 'value', condition: 'regex', depth: '3', depthType: 'value', outputVar: 'out', indent: 0 })).rejects.toBeInstanceOf(SyntaxError);
    });

    test('invalid depth returns false before constructing the search regex', async () => {
      expect(await run({ type: 'v2QuickSearchChat', value: '[', valueType: 'value', condition: 'regex', depth: 'bad', depthType: 'value', outputVar: 'out', indent: 0 })).toBe('0');
    });
  });
}

describe('Lua message reads retain their separate Risu semantics', () => {
  async function read(rows: HostMessage[]) {
    const { runtime } = await runTriggerEffects([], {}, { preloaded: { messagesRaw: [greeting, ...rows] } });
    await runtime.runLua(`
      setChatVar("test", "user", getUserLastMessage("test"))
      setChatVar("test", "character", getCharacterLastMessage("test"))
      local last = getChat("test", -1)
      setChatVar("test", "last", last and last.data or "missing")
    `);
    return { user: runtime.getVar('user'), character: runtime.getVar('character'), last: runtime.getVar('last') };
  }

  test('a greeting-only chat has no user or indexed message', async () => {
    expect(await read([])).toEqual({ user: '', character: 'Greeting', last: 'missing' });
  });

  test('negative indices still select the last chat message', async () => {
    expect(await read(messages)).toEqual({ user: 'Four\nFive', character: 'THREE', last: 'Four\nFive' });
  });

  test('an existing empty character message does not fall back to the greeting', async () => {
    expect(await read([
      { id: 'empty', role: 'assistant', content: '' },
      { id: 'last', role: 'user', content: 'null' },
    ])).toEqual({ user: 'null', character: '', last: 'null' });
  });
});
