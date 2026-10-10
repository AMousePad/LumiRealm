import { afterEach, describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { commitInvocation, type TriggerInvocationState } from '../../src/interpreter/runtime/invocation.js';
import type { HostApi, HostMessage } from '../../src/interpreter/host.js';

import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';

afterEach(clearLuaEngines);

const initial = [
  { role: 'user', data: 'A', time: 0 }, { role: 'char', data: 'B', time: 0 },
  { role: 'user', data: 'C', time: 0 }, { role: 'char', data: 'D', time: 0 },
];

async function run(body: string, staged: boolean) {
  const greeting = { id: 'greeting', role: 'assistant', content: 'Greeting' };
  const rows: HostMessage[] = [greeting, ...initial.map((m, i) => ({
    id: `row-${i}`, role: m.role === 'user' ? 'user' : 'assistant', content: m.data,
  }))];
  const calls: string[] = [];
  let nextId = 0;
  const api: HostApi = {
    chat: {
      getMessages: async () => rows.map(row => ({ ...row })),
      getMetadata: async () => null, setMetadata: async () => {}, inject: async () => {},
      sendMessage: async (content, options) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        const id = `new-${++nextId}`;
        calls.push(`send:${id}`);
        rows.push({ id, content, role: options?.role ?? 'assistant' });
        return { id };
      },
      editMessage: async (id, content) => {
        calls.push(`edit:${id}`);
        const index = rows.findIndex(row => row.id === id);
        expect(index).toBeGreaterThanOrEqual(0);
        rows[index] = { ...rows[index]!, content };
      },
      deleteMessage: async id => {
        calls.push(`delete:${id}`);
        const index = rows.findIndex(row => row.id === id);
        expect(index).toBeGreaterThanOrEqual(0);
        rows.splice(index, 1);
      },
    }, characters: { get: async () => ({ id: 'character' }), update: async () => {} },
  };
  const state: TriggerInvocationState = { stopSending: false };
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(execute), {
    binding: 'manual', ...(staged ? { invocationState: state } : {}),
    preloaded: { varsCache: {}, globalVars: {}, messagesRaw: rows.map(row => ({ ...row })),
      lorebook: { entries: [], primaryBookId: null } },
  });
  const output = JSON.parse(await runtime.runLua(`function probe(id) ${body} end`, {
    entry: 'probe', args: ['access'],
  }) as string);
  await runtime.flush();
  if (staged) { expect(calls).toEqual([]); await commitInvocation(state); }
  expect(rows[0]).toEqual(greeting);
  return { output, persisted: rows.slice(1).map(row => ({
    role: row.role === 'user' ? 'user' : 'char', data: row.content, time: 0,
  })), calls };
}

const indexes = [
  ['0', 0, 0], ['-1', 3, 3], ['0.5', 0, 0], ['1.9', 1, 1],
  ['-0.5', 0, 0], ['-1.5', 3, 3], ['0/0', 0, 0], ['nil', 0, 0],
  ["'bad'", 0, 0], ['-99', null, 0], ['99', null, null],
  ['math.huge', null, null], ['-math.huge', null, 0],
] as const;

describe('Risu Lua message index coercion', () => {
  for (const [index, at, removed] of indexes) {
    test(`getChat selects index ${index}`, async () => {
      const result = await run(`return json.encode(getChat(id,${index}))`, false);
      expect(result.output).toEqual(at === null ? null : initial[at]);
      expect(result.persisted).toEqual(initial);
    });

    for (const operation of ['setChat', 'setChatRole', 'removeChat'] as const) {
      test(`${operation} keeps cached and persisted index ${index} aligned`, async () => {
        const expected = initial.map(row => ({ ...row }));
        if (operation === 'removeChat') {
          if (removed !== null) expected.splice(removed, 1);
        } else if (at !== null) {
          if (operation === 'setChat') expected[at]!.data = 'Changed';
          else expected[at]!.role = at % 2 === 0 ? 'char' : 'user';
        }
        const call = operation === 'setChat' ? `setChat(id,${index},'Changed')`
          : operation === 'setChatRole' ? `setChatRole(id,${index},'${at !== null && at % 2 === 0 ? 'char' : 'user'}')`
          : `removeChat(id,${index})`;
        for (const staged of [false, true]) {
          const result = await run(`${call}; return json.encode(getFullChat(id))`, staged);
          expect(result.output).toEqual(expected);
          expect(result.persisted).toEqual(expected);
        }
      });
    }
  }

  test.each([
    `addChat(id,'char','Added');setChat(id,-1.9,'Changed');removeChat(id,-1.5)`,
    `addChat(id,'user','Added');setChatRole(id,-1.9,'char');setChat(id,-1.5,'Changed');removeChat(id,-1.5)`,
  ])('pending sends retain the correct row through later operations: %s', async body => {
    for (const staged of [false, true]) {
      const result = await run(`${body};return json.encode(getFullChat(id))`, staged);
      expect(result.output).toEqual(initial);
      expect(result.persisted).toEqual(initial);
    }
  });
});
