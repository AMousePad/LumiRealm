import { describe, test, expect } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import type { HostApi, ScriptNS, DispatchData, HostMessage } from '../../src/interpreter/host.js';

// Risu scriptings.ts declareAPI('getRecentChatsMain') returns the last `count`
// messages as {role, data, time}, oldest first, and the prelude wraps it in
// getRecentChats(id, count). Cards call it to look back over the tail of the
// chat, so the slice boundaries and the clamping both matter.

function makeMockScriptNS(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error('mock require: unknown ' + name);
    },
  } as unknown as ScriptNS;
}

function makeApi(messages: HostMessage[]): HostApi {
  return {
    chat: {
      getMessages: async () => messages,
      sendMessage: async () => ({ id: 'mock' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => null,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: { get: async (id: string) => ({ id }), update: async () => {} },
  } as unknown as HostApi;
}

const history: HostMessage[] = [
  { id: 'm1', role: 'user', content: 'first', createdAt: 111 },
  { id: 'm2', role: 'assistant', content: 'second', createdAt: 222 },
  { id: 'm3', role: 'user', content: 'third', createdAt: 333 },
  { id: 'm4', role: 'assistant', content: 'fourth', createdAt: 444 },
];

const dispatchData: DispatchData = { characterId: 'c-test', chatId: 'chat-1' };

type RecentRow = { role: string; data: string; time: number };

async function readRecent(code: string): Promise<unknown> {
  const rt = await makeRisuTriggerRuntime(makeApi(history), dispatchData, makeMockScriptNS());
  await rt.runLua(`
    function probe()
      local got = getRecentChats('t', ${code})
      setChatVar('t', 'out', json.encode(got))
    end
    probe()
  `);
  return JSON.parse(String(rt.getVar('out'))) as unknown;
}

describe('runtime getRecentChats — Risu parity', () => {
  test('returns the last count messages, oldest first', async () => {
    const rows = (await readRecent('2')) as RecentRow[];
    expect(rows.map((r) => r.data)).toEqual(['third', 'fourth']);
    // Risu's own role names: the character side is 'char', not 'assistant'.
    expect(rows.map((r) => r.role)).toEqual(['user', 'char']);
  });

  test('carries the message time so a card can window by timestamp', async () => {
    const rows = (await readRecent('2')) as RecentRow[];
    expect(rows.map((r) => r.time)).toEqual([333, 444]);
  });

  test('clamps a count larger than the chat to the whole history', async () => {
    const rows = (await readRecent('99')) as RecentRow[];
    expect(rows.length).toBe(history.length);
    expect(rows[0]!.data).toBe('first');
  });

  test('treats zero and negative counts as an empty window, not the whole chat', async () => {
    expect(await readRecent('0')).toEqual([]);
    expect(await readRecent('-3')).toEqual([]);
  });
});
