import { describe, expect, test } from 'bun:test';
import type { HostApi, HostMessage } from '../../../src/interpreter/host.js';
import type { TriggerEffect, TriggerScript } from '../../../src/core/schemas/triggerscript.js';
import { makeRisuTriggerRuntime } from '../../../src/interpreter/runtime.js';
import { makeDispatcherScriptNS } from '../../../src/interpreter/dispatcher.js';
import { interpretTrigger } from '../../../src/interpreter/trigger-interpreter.js';
import { compileTrigger } from '../../../src/core/triggers/compile.js';
import { basicTriggerContext } from '../../helpers/trigger-runtime.js';

async function fixture(withGreeting = true) {
  const rows: HostMessage[] = [
    ...(withGreeting ? [{ id: 'greeting', role: 'assistant', content: 'Greeting' }] : []),
    ...['A', 'B', 'C', 'D'].map((content, index) => ({ id: content, role: index % 2 ? 'assistant' : 'user', content })),
  ];
  const deleted: string[] = [];
  const faults = { id: '', afterDelete: false, refresh: false };
  const metadata: Record<string, unknown> = { chat_variables: {} };
  const api: HostApi = {
    chat: {
      getMessages: async () => {
        if (faults.refresh) throw new Error('Refresh failed');
        return rows.map(row => ({ ...row }));
      },
      sendMessage: async (content, options) => {
        const id = 'added-' + rows.length;
        rows.push({ id, role: options?.role ?? 'user', content });
        return { id };
      },
      deleteMessage: async id => {
        if (id === faults.id && !faults.afterDelete) throw new Error('Delete failed');
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) throw new Error('Missing message ID');
        rows.splice(index, 1);
        deleted.push(id);
        if (id === faults.id) throw new Error('Delete failed after commit');
      },
      editMessage: async () => { throw new Error('Unexpected edit'); },
      getMetadata: async key => metadata[key],
      setMetadata: async (key, value) => { metadata[key] = value; },
      inject: async () => { throw new Error('Unexpected injection'); },
    },
    characters: { get: async id => ({ id }), update: async () => { throw new Error('Unexpected character write'); } },
  };
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(), {
    preloaded: { messagesRaw: rows }, templateContext: basicTriggerContext,
  });
  async function run(effects: TriggerEffect[], execution: 'interpreted' | 'compiled') {
    const trigger: TriggerScript = { type: 'manual', comment: '', conditions: [], effect: effects };
    const gates = { displayMode: false, lowLevelAccess: false, stepBudget: 1000 };
    if (execution === 'compiled') {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction('__risu', 'console', compileTrigger(trigger, gates).body)(runtime, console);
    } else await interpretTrigger(trigger, runtime, console, gates);
  }
  const contents = () => Array.from({ length: runtime.getMessageCount() }, (_, index) => runtime.getMessageAtIndex(index));
  return { rows, deleted, faults, runtime, run, contents };
}

for (const execution of ['interpreted', 'compiled'] as const) {
  for (const type of ['cutchat', 'v2CutChat'] as const) {
    describe(`${execution} ${type} matches Risu runTrigger retained slices`, () => {
      for (const [start, end, expected] of [
        ['1', '3', ['B', 'C']], ['0', '0', []], ['3', '1', []],
        ['-2', '99', ['C', 'D']], ['-99', '2', ['A', 'B']], ['0', '-1', ['A', 'B', 'C']],
        ['1.9', '3.9', ['B', 'C']], ['-Infinity', 'Infinity', ['A', 'B', 'C', 'D']],
        ['Infinity', 'Infinity', []], ['bad', '2', ['A', 'B']],
        ['1', 'bad', type === 'v2CutChat' ? ['B', 'C', 'D'] : []],
        ['', '', []],
      ] as const) {
        test(`keeps ${start} through ${end} without touching the greeting`, async () => {
          const h = await fixture();
          await h.run([{ type, start, end, startType: 'value', endType: 'value', indent: 0 }], execution);
          expect(h.contents()).toEqual([...expected]);
          expect(h.rows.map(row => row.content)).toEqual(['Greeting', ...expected]);
          expect(h.deleted).not.toContain('greeting');
        });
      }
    });
  }

  test(`${execution} v2 cut resolves variable operands before changing the message array`, async () => {
    const h = await fixture();
    h.runtime.setVar('start', '1');
    h.runtime.setVar('end', '3');
    await h.run([{ type: 'v2CutChat', start: 'start', startType: 'var', end: 'end', endType: 'var', indent: 0 }], execution);
    expect(h.contents()).toEqual(['B', 'C']);
  });

  for (const afterDelete of [false, true]) {
    test(`${execution} reconciles partial cut failure ${afterDelete ? 'after' : 'before'} the rejected deletion commits`, async () => {
      const h = await fixture();
      h.faults.id = 'C';
      h.faults.afterDelete = afterDelete;
      await expect(h.run([
        { type: 'cutchat', start: '0', end: '1' },
        { type: 'setvar', var: 'after', value: 'wrong', operator: '=' },
      ], execution)).rejects.toMatchObject({ name: 'ChatMutationError' });
      const expected = afterDelete ? ['A', 'B'] : ['A', 'B', 'C'];
      expect(h.contents()).toEqual(expected);
      expect(h.rows.map(row => row.content)).toEqual(['Greeting', ...expected]);
      expect(h.runtime.getVar('after')).toBe('null');
    });
  }
}

test('a failed recovery keeps acknowledged deletions reflected and reports both errors', async () => {
  const h = await fixture();
  h.faults.id = 'C';
  h.faults.refresh = true;
  await expect(h.runtime.cutChat(0, 1)).rejects.toMatchObject({ name: 'ChatMutationError', cause: expect.any(AggregateError) });
  expect(h.contents()).toEqual(['A', 'B', 'C']);
});

for (const [argumentsText, expected] of [
  ['1, 3', ['B', 'C']], ['-2', ['C', 'D']], ['1, nil', []], ['0, 0', []],
] as const) {
  test(`Lua cutChat(${argumentsText}) completes before the next Lua message read`, async () => {
    const h = await fixture();
    await h.runtime.runLua(`cutChat("test", ${argumentsText})\nsetChatVar("test", "length", tostring(getChatLength("test")))`);
    await h.runtime.flush();
    expect(h.runtime.getVar('length')).toBe(String(expected.length));
    expect(h.contents()).toEqual([...expected]);
    expect(h.rows.map(row => row.content)).toEqual(['Greeting', ...expected]);
  });
}

test('Lua cut waits for a preceding addChat to receive its real host ID', async () => {
  const h = await fixture();
  await h.runtime.runLua('addChat("test", "char", "temporary")\ncutChat("test", 0, 4)');
  await h.runtime.flush();
  expect(h.contents()).toEqual(['A', 'B', 'C', 'D']);
  expect(h.rows.map(row => row.content)).toEqual(['Greeting', 'A', 'B', 'C', 'D']);
  expect(h.deleted).toEqual(['added-5']);
});

test('queued Lua deletion failures reject flush and reconcile optimistic message reads', async () => {
  const h = await fixture();
  h.faults.id = 'D';
  await h.runtime.runLua('cutChat("test", 0, 1)\nsetChatVar("test", "length", tostring(getChatLength("test")))');
  expect(h.runtime.getVar('length')).toBe('1');
  await expect(h.runtime.flush()).rejects.toMatchObject({ name: 'ChatMutationError' });
  expect(h.contents()).toEqual(['A', 'B', 'C', 'D']);
});

for (const lua of [false, true]) {
  test(`${lua ? 'Lua' : 'structured'} recovery does not treat a remaining assistant as a new greeting`, async () => {
    const h = await fixture(false);
    h.faults.id = 'A';
    h.faults.afterDelete = true;
    if (lua) {
      await h.runtime.runLua('cutChat("test", 1, 4)');
      await expect(h.runtime.flush()).rejects.toMatchObject({ name: 'ChatMutationError' });
    } else await expect(h.runtime.cutChat(1, 4)).rejects.toMatchObject({ name: 'ChatMutationError' });
    expect(h.contents()).toEqual(['B', 'C', 'D']);
  });
}

test('a queued Lua cut failure stops a following structured cut', async () => {
  const h = await fixture();
  h.faults.id = 'D';
  await h.runtime.runLua('cutChat("test", 0, 2)');
  await expect(h.runtime.cutChat(0, 1)).rejects.toMatchObject({ name: 'ChatMutationError' });
  expect(h.deleted).toEqual([]);
  expect(h.contents()).toEqual(['A', 'B', 'C', 'D']);
});

test('failed queued cuts reconcile rows appended and then cut later in the same Lua script', async () => {
  const h = await fixture();
  h.faults.id = 'D';
  await h.runtime.runLua('cutChat("test", 0, 2)\naddChat("test", "char", "new")\ncutChat("test", 0, 1)');
  await expect(h.runtime.flush()).rejects.toMatchObject({ name: 'ChatMutationError' });
  expect(h.contents()).toEqual(['A', 'B', 'C', 'D', 'new']);
});
