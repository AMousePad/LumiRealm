import { describe, expect, test } from 'bun:test';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import type { HostMessage } from '../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';

import { execute } from '../../src/interpreter/lua-bridge.js';
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

const messages: HostMessage[] = [
  { id: 'greeting', role: 'assistant', content: 'Greeting' },
  { id: 'user', role: 'user', content: 'Hello', createdAt: 1700000000000 },
  { id: 'answer', role: 'assistant', content: 'Welcome' },
];
const expectedChat = [
  { role: 'user', data: 'Hello', time: 1700000000000 },
  { role: 'char', data: 'Welcome', time: 0 },
];

async function run(body: string, messagesRaw = messages) {
  const runtime = await makeRisuTriggerRuntime(makeLuaDivergenceHost().api, {}, makeDispatcherScriptNS(execute), {
    binding: 'manual', lowLevelAccess: false,
    preloaded: { varsCache: {}, globalVars: {}, messagesRaw,
      lorebook: { entries: [], primaryBookId: null } },
  });
  return runtime.runLua(`function probe(id) ${body} end`, { entry: 'probe', args: ['read-key'] });
}

// Risu's runScripted uses Array.at for direct reads and count || 0 before flooring recent counts.
describe('Lua direct and recent chat readers', () => {
  test.each([
    ['0', 'Hello|user'], ['-1', 'Welcome|char'], ['0.5', 'Hello|user'],
    ['-0.5', 'Hello|user'], ['0/0', 'Hello|user'], ['nil', 'Hello|user'],
    ['9', '|'], ['-9', '|'],
  ])('reads data and role at index %s', async (index, expected) => {
    expect(await run(`return getChatData(id, ${index}) .. '|' .. getChatRole(id, ${index})`)).toBe(expected);
  });

  test.each([
    ['nil', 0], ['0', 0], ['-1', 0], ['0.9', 0], ['1', 1], ['1.9', 1],
    ['2', 2], ['9', 2], ['0/0', 0], ['math.huge', 2], ['-math.huge', 0],
    ["'bad'", 2], ['false', 0], ['true', 1],
  ] as const)('returns the recent tail for count %s', async (count, length) => {
    const output = await run(`return json.encode(getRecentChats(id, ${count}))`);
    expect(JSON.parse(output as string)).toEqual(length === 0 ? [] : expectedChat.slice(-length));
  });

  test('a greeting-only chat has no direct or recent messages', async () => {
    expect(await run(`return getChatData(id, 0) .. '|' .. getChatRole(id, -1)
      .. '|' .. json.encode(getRecentChats(id, 9))`, [messages[0]!])).toBe('||[]');
  });

  test('recent records match the current full and single-message timestamp shapes', async () => {
    const output = await run(`return json.encode({
      recent = getRecentChats(id, 2), all = getFullChat(id), first = getChat(id, 0)
    })`);
    expect(JSON.parse(output as string)).toEqual({ recent: expectedChat, all: expectedChat, first: expectedChat[0] });
  });
});
