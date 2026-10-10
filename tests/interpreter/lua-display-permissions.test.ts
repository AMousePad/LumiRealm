import { describe, expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge.js';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import type { HostApi, HostMessage, TriggerRuntimePreloaded } from '../../src/interpreter/host.js';
import { runListenEditChain, type ListenEditMode } from '../../src/interpreter/listen-edit.js';

const mutations = [
  ['setChat', "setChat(id, 0, 'changed')"],
  ['setChatRole', "setChatRole(id, 0, 'char')"],
  ['cutChat', 'cutChat(id, 0, 0)'],
  ['removeChat', 'removeChat(id, 0)'],
  ['addChat', "addChat(id, 'user', 'added')"],
  ['insertChat', "insertChat(id, 0, 'user', 'inserted')"],
  ['setFullChat', "setFullChat(id, {{role='char', data='replacement'}})"],
] as const;

async function run(mode: ListenEditMode, body: string) {
  const calls: string[] = [];
  const saved: Record<string, unknown> = {};
  const messages: HostMessage[] = [
    { id: 'greeting', role: 'assistant', content: 'Greeting' },
    { id: 'message', role: 'user', content: 'Original' },
  ];
  const record = async () => { calls.push('host'); };
  const api: HostApi = {
    chat: {
      getMessages: async () => messages,
      getMetadata: async () => null,
      setMetadata: async (key, value) => { saved[key] = value; },
      sendMessage: async () => { calls.push('send'); return { id: 'new' }; },
      editMessage: record, deleteMessage: record, inject: record,
    },
    characters: { get: async id => ({ id, description: 'Description' }), update: record },
    ui: { alert: record, prompt: async () => { calls.push('prompt'); return ''; },
      pick: async () => { calls.push('pick'); return ''; },
      confirm: async () => { calls.push('confirm'); return true; } },
    tokens: { count: async () => { calls.push('tokens'); return 1; } },
  };
  const preloaded: TriggerRuntimePreloaded = {
    varsCache: {}, globalVars: {}, messagesRaw: messages,
    lorebook: { entries: [], primaryBookId: null },
  };
  const output = await runListenEditChain([
    { source: { effect: [{ type: 'triggerlua' }] }, luaCode:
      `listenEdit('${mode}', function(id, value) ${body} end)` },
  ], mode, 'Input', {}, api, {}, makeDispatcherScriptNS(execute), { characterId: 'character', preloaded });
  return { output, calls, saved };
}

// Risu runScripted grants editDisplay variable writes without a ScriptingSafeIds entry.
describe('Lua editDisplay permissions', () => {
  for (const [name, expression] of mutations) {
    test(`${name} cannot change cached or persisted display history`, async () => {
      const result = await run('editDisplay', `${expression}; return json.encode(getFullChat(id))`);
      expect(JSON.parse(result.output)).toEqual([{ role: 'user', data: 'Original', time: 0 }]);
      expect(result.calls).toEqual([]);
    });

    test(`${name} remains available in editOutput`, async () => {
      const result = await run('editOutput', `${expression}; return json.encode(getFullChat(id))`);
      expect(JSON.parse(result.output)).not.toEqual([{ role: 'user', data: 'Original', time: 0 }]);
      expect(result.calls.length).toBeGreaterThan(0);
    });
  }

  test('display variables and state still persist', async () => {
    const result = await run('editDisplay', `
      setChatVar(id, 'flag', 'yes')
      setState(id, 'state', {count=2})
      return getChatVar(id, 'flag') .. '|' .. tostring(getState(id, 'state').count)
    `);
    expect(result.output).toBe('yes|2');
    expect(result.saved.chat_variables).toEqual({ flag: 'yes', __state: '{"count":2}' });
  });

  test('safe-only public APIs deny display calls before host effects', async () => {
    const result = await run('editDisplay', `
      stopChat(id)
      alertError(id, 'error'); alertNormal(id, 'notice')
      assert(alertInput(id, 'input') == nil)
      assert(alertSelect(id, {'choice'}) == nil)
      assert(alertConfirm(id, 'confirm') == nil)
      assert(sleep(id, 0) == nil)
      assert(getTokens(id, 'text'):await() == nil)
      assert(setName(id, 'changed') == nil)
      assert(getDescription(id) == nil)
      assert(setDescription(id, 'changed') == nil)
      assert(setCharacterFirstMessage(id, 'changed') == nil)
      assert(getBackgroundEmbedding(id) == nil)
      setBackgroundEmbedding(id, 'changed')
      upsertLocalLoreBook(id, 'entry', 'changed', {})
      reloadDisplay(id); reloadChat(id, 0)
      return 'completed'
    `);
    expect(result.output).toBe('completed');
    expect(result.calls).toEqual([]);
  });
});
