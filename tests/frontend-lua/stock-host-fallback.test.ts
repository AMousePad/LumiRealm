import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { createFrontendLuaBackend } from '../../src/frontend-lua/backend.js';
import { divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { clearLuaEngines } from '../helpers/lua-bridge.js';

const stock = { messageMutations: false, resolvedLore: false };
afterEach(async () => { for (const mode of ['editInput', 'input']) await clearWasmoonEngine(mode); });

// The host gate refuses these fields, so any of them would fail the Lua write on a stock host.
function gated(writes: readonly Record<string, unknown>[]): unknown[] {
  return writes.filter(write => (write.kind === 'message.edit' && write.role !== undefined) || (write.kind === 'message.create' && write.beforeId !== undefined));
}

test('setChatRole rebuilds rows without a host role edit', async () => {
  const f = frontendRuntime(undefined, stock);
  await f.run("listenEdit('editInput',function(id,text) setChatRole(id,0,'char');return text end)");
  expect(gated(f.writes as never)).toEqual([]);
  expect(f.state.messages.map(message => [message.role, message.content])).toEqual([['assistant', 'Hello'], ['assistant', 'Welcome']]);
});

test.each([0, 1, -1])('insertChat at %s lands in place without a host insertion', async index => {
  const f = frontendRuntime(undefined, stock);
  await f.run(`listenEdit('editInput',function(id,text) insertChat(id,${index},'user','Inserted');return text end)`);
  expect(gated(f.writes as never)).toEqual([]);
  const expected = ['Hello', 'Welcome']; expected.splice(index < 0 ? 1 : index, 0, 'Inserted');
  expect(f.state.messages.map(message => message.content)).toEqual(expected);
});

test('insertChat at the end stays a plain append', async () => {
  const f = frontendRuntime(undefined, stock);
  await f.run("listenEdit('editInput',function(id,text) insertChat(id,2,'user','Inserted');return text end)");
  expect(f.writes.map(write => write.kind)).toEqual(['message.create']);
  expect(gated(f.writes as never)).toEqual([]);
});

test('hosts with mutations keep the row preserving path', async () => {
  const f = frontendRuntime(undefined, { messageMutations: true, resolvedLore: true });
  await f.run("listenEdit('editInput',function(id,text) setChatRole(id,0,'char');return text end)");
  expect(f.writes.map(write => write.kind)).toEqual(['message.edit']);
  expect(f.dto.messages.map(message => message.id)).toEqual(['greeting', 'user', 'reply']);
});

test('loadLoreBooks lists entries locally when the host cannot resolve them', async () => {
  const seed = frontendRuntime().dto;
  seed.lore = [{ id: 'one', world_book_id: 'book', order_value: 1, comment: 'One', content: 'first', key: ['never'], keysecondary: [], constant: false, disabled: false }] as never;
  const f = frontendRuntime(seed, stock);
  const runtime = await makeRisuTriggerRuntime(f.host.api, {}, divergenceLuaScriptNS, { ...f.host.prepareRuntime(), lowLevelAccess: true });
  const result = await runtime.runLua("probe = async(function(id) local books = loadLoreBooks(id) return tostring(#books)..'|'..books[1].data end)", { entry: 'probe' });
  expect(result).toBe('1|first');
  expect(f.counts().serviceCalls).toBe(0);
  await clearLuaEngines();
});

test('bootstrap tells the frontend what the host supports', async () => {
  const sent: { payload: { result?: { hostSupport?: unknown }; value?: { hostSupport?: unknown }; ok?: boolean; error?: string } }[] = [];
  const state = { revision: { epoch: 'host', sequence: 1 }, globalVariables: {} };
  const host = {
    generate: { raw: async () => { throw new Error('Unexpected generation'); } }, userStorage: { getJson: async () => null },
    host: { capabilities: Object.fromEntries(['frontend-session-routing-v1', 'runtime-state-v1', 'required-context-handlers-v1', 'required-interceptors-v1'].map(name => [name, 1])) },
    runtimeState: { read: async () => state, write: async () => ({ revision: state.revision, patch: {} }) },
    sendToFrontend(payload: never) { sent.push({ payload }); },
  } as unknown as Parameters<typeof createFrontendLuaBackend>[0];
  const saved = (globalThis as { spindle?: unknown }).spindle;
  (globalThis as { spindle?: unknown }).spindle = host;
  const backend = createFrontendLuaBackend(host, async () => ({ snapshot: {}, settings: {} }) as never);
  try {
    await backend.receive({ type: 'lua_service', requestId: 'request', chatId: 'chat', characterId: 'character', request: { kind: 'bootstrap' } }, 'owner', 'document');
    expect(sent[0]!.payload.value?.hostSupport).toEqual({ messageMutations: false, resolvedLore: false });
  } finally { backend.dispose(); (globalThis as { spindle?: unknown }).spindle = saved; }
});
