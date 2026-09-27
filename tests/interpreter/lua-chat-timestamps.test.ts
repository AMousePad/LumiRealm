import { afterEach, describe, expect, test } from 'bun:test';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';
import { assembleDisplaySnapshot } from '../../src/state/display-snapshot-assembly.js';
import { execute } from '../../src/interpreter/lua-bridge.js';
import { runtimeMessage } from '../../src/frontend-lua/state-contract.js';

const rows = [
  { id: 'greeting', role: 'assistant', content: 'Greeting', send_date: 1 },
  { id: 'user', role: 'user', content: 'Hello', send_date: 1700000000, created_at: 1800000000 },
  { id: 'answer', role: 'assistant', content: 'Reply', created_at: 1700000001 },
  { id: 'zero', role: 'user', content: 'Zero', send_date: 0, created_at: 1700000002 },
  { id: 'missing', role: 'user', content: 'Missing' },
];

function host() {
  (globalThis as { spindle?: unknown }).spindle = {
    generate: { raw: async () => { throw new Error('Unexpected model request'); } },
    chat: { getMessages: async () => rows, appendMessage: async () => ({ id: 'added' }) },
    chats: { get: async () => ({ metadata: {} }) },
    characters: { get: async () => ({ name: 'Character', world_book_ids: [] }) },
    personas: { getActive: async () => ({ name: 'User' }) },
  };
  return makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'user' });
}

afterEach(() => { delete (globalThis as { spindle?: unknown }).spindle; });

describe('Risu runScripted chat timestamps', () => {
  test('the backend adapter converts host seconds to milliseconds without replacing zero', async () => {
    expect((await host().chat.getMessages()).map(m => m.createdAt))
      .toEqual([1000, 1700000000000, 1700000001000, 0, 0]);
  });

  for (const path of ['backend', 'display snapshot', 'frontend state'] as const) {
    test(`${path} exposes the same timestamps through public Lua readers`, async () => {
      const api = host();
      const snapshot = path === 'display snapshot' ? await assembleDisplaySnapshot({
        modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false,
        getCompiledLibraries: () => [],
      }, { card: { character_id: 'character', asset_index: {}, emotion_index: {},
        risuPayload: { triggers: [], lua_scripts: [], at_actions: [], scriptstate_defaults: {} },
      } } as never, 'chat', 'user', { local: {}, global: {}, chat: {} }) : null;
      const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(execute), {
        binding: 'manual', preloaded: { varsCache: {}, globalVars: {},
          lorebook: { entries: [], primaryBookId: null },
          ...(snapshot ? { messagesRaw: snapshot.messagesHost } : {}),
          ...(path === 'frontend state' ? { messagesRaw: rows.map((row, index_in_chat) => runtimeMessage({ ...row, index_in_chat })) } : {}),
        },
      });
      const output = await runtime.runLua(`function probe(id)
        local first = getChat(id, 0)
        local last = getChat(id, -1)
        addChat(id, 'char', 'New')
        return json.encode({first = first, last = last, all = getFullChat(id), recent = getRecentChats(id, 2)})
      end`, { entry: 'probe', args: ['key'] });
      await runtime.flush();
      const all = [
        { role: 'user', data: 'Hello', time: 1700000000000 },
        { role: 'char', data: 'Reply', time: 1700000001000 },
        { role: 'user', data: 'Zero', time: 0 },
        { role: 'user', data: 'Missing', time: 0 },
        { role: 'char', data: 'New', time: 0 },
      ];
      expect(JSON.parse(output as string)).toEqual({ first: all[0], last: all[3], all, recent: all.slice(-2) });
      if (snapshot) expect(snapshot.chat.messages.map(m => m.createdAt))
        .toEqual([1700000000000, 1700000001000, 0, 0]);
    });
  }
});
