import { describe, expect, test } from 'bun:test';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import type { HostMessage } from '../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { encodeFullChatParts } from '../../src/util/lua-message-data.js';
import { execute } from '../helpers/lua-bridge.js';
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

const tricky = [
  'plain', '', '한국어 본문', 'emoji 😀 and é', 'line\nbreak\r\nand\ttab', 'quote " back\\slash /', '\u0001 control \u001f',
  'nul \0 inside', 'lone \ud83d surrogate', 'trailing \udc00', 'json {"a":[1,2]}', '{{macro}} <user>', '  separators  ', 'x'.repeat(70_000),
];

function row(content: string, index: number): HostMessage {
  return { id: `m${index}`, role: index % 2 ? 'user' : 'assistant', content, createdAt: 1_700_000_000_000 + index };
}

async function run(body: string, messagesRaw: HostMessage[]) {
  const runtime = await makeRisuTriggerRuntime(makeLuaDivergenceHost().api, {}, makeDispatcherScriptNS(execute), {
    binding: 'manual', lowLevelAccess: false,
    preloaded: { varsCache: {}, globalVars: {}, messagesRaw, lorebook: { entries: [], primaryBookId: null } },
  });
  return runtime.runLua(`function probe(id) ${body} end`, { entry: 'probe', args: ['read-key'] });
}

const SAME = `
  local function same(a, b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= 'table' then return a == b and math.type(a) == math.type(b) end
    for k, v in pairs(a) do if not same(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
  end
  return same(getFullChat(id), json.decode(getFullChatMain(id)))`;

describe('getFullChat fast path', () => {
  test('matches the JSON decode for every message body shape', async () => {
    expect(await run(SAME, [{ id: 'g', role: 'assistant', content: 'greeting' }, ...tricky.map(row)])).toBe(true);
  });

  test('matches the JSON decode for raw Lua message data', async () => {
    const raw = (value: unknown, index: number): HostMessage => ({ ...row('text', index), luaData: { value } });
    const messages = [{ id: 'g', role: 'assistant', content: 'greeting' } as HostMessage,
      raw(42, 1), raw(0, 2), raw(false, 3), raw(null, 4), raw(undefined, 5), raw({ nested: ['a'] }, 6), raw('string data', 7), row('after', 8)];
    expect(await run(SAME, messages)).toBe(true);
  });

  test('handles an empty chat and a greeting-only chat', async () => {
    expect(await run(SAME, [])).toBe(true);
    expect(await run(SAME, [{ id: 'g', role: 'assistant', content: 'greeting' }])).toBe(true);
  });

  test('returns raw tables that json.encode and table helpers accept', async () => {
    const messages = [{ id: 'g', role: 'assistant', content: 'greeting' } as HostMessage, row('Alpha', 1), row('Beta', 2)];
    expect(await run(`
      local chat = getFullChat(id)
      local encoded = json.decode(json.encode(chat))
      table.insert(chat, { role = 'user', data = 'New', time = 0 })
      return rawlen(chat) .. '|' .. tostring(next(chat)) .. '|' .. encoded[2].data .. '|' .. tostring(chat[1].len)`, messages)).toBe('3|1|Beta|nil');
  });

  test('hides its host function from scripts', async () => {
    expect(await run('return tostring(getFullChatPartsMain)', [])).toBe('nil');
  });

  test('keeps unsafe strings out of the sliced bodies', () => {
    const encoded = encodeFullChatParts([
      { role: 'user', data: 'é😀', time: 1 },
      { role: 'char', data: 'a\0b', time: 2 },
      { role: 'char', data: 'lone \ud83d', time: 3 },
    ]);
    const split = encoded.indexOf('\n');
    expect(JSON.parse(encoded.slice(0, split))).toEqual([
      { role: 'user', time: 1, len: 6 },
      { role: 'char', data: 'a\0b', time: 2 },
      { role: 'char', data: 'lone \ud83d', time: 3 },
    ]);
    expect(encoded.slice(split + 1)).toBe('é😀');
  });
});
