import { afterEach, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { clearLuaEngines, execute } from '../../src/interpreter/lua-bridge.js';
import { observeLuaHostState, prepareLuaHostState } from '../../src/interpreter/runtime/lua-state.js';
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';
import type { HostApi, ScriptNS } from '../../src/interpreter/host.js';
import type { ExecuteOpts } from '../../src/interpreter/lua-engine.js';

afterEach(() => clearLuaEngines());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function pause() {
  const entered = deferred(), release = deferred();
  const script: ScriptNS = { require: async () => ({
    execute: (code: string, globals: Record<string, unknown>, opts: ExecuteOpts) => execute(code, {
      ...globals, sleep: async () => { entered.resolve(); await release.promise; return true; },
    }, opts),
  }) };
  return { entered, release, script };
}
async function runtime(api: HostApi, mode = 'start', script = divergenceLuaScriptNS) {
  return makeRisuTriggerRuntime(api, { characterId: 'test-character' }, script, {
    characterId: 'test-character', binding: mode, templateContext: basicTriggerContext,
  });
}
function characterEvent(api: HostApi, name: string) {
  observeLuaHostState(api.luaStateScope ?? api.characters, 'CHARACTER_EDITED', {
    id: 'test-character', character: { id: 'test-character', name, description: 'Description', first_mes: 'Greeting' },
  });
}

test('a suspended Lua callback reads current identity and CBS after an external edit', async () => {
  const host = makeLuaDivergenceHost(), gate = pause();
  const rt = await runtime(host.api, 'start', gate.script);
  const pending = rt.runLua(`onStart=async(function(id)
    local before=getName(id); sleep(id,0):await()
    return before..'|'..getName(id)..'|'..cbs('{{char}}')
  end)`);
  await gate.entered.promise;
  host.character.name = 'External';
  characterEvent(host.api, 'External');
  gate.release.resolve();
  expect(await pending).toBe('Character|External|External');
});

test('an external edit is visible after await even when its notification is delayed', async () => {
  const host = makeLuaDivergenceHost(), gate = pause();
  const rt = await runtime(host.api, 'start', gate.script);
  const pending = rt.runLua(`onStart=async(function(id) sleep(id,0):await(); return getName(id) end)`);
  await gate.entered.promise;
  host.character.name = 'Committed before notification';
  gate.release.resolve();
  expect(await pending).toBe('Committed before notification');
});

test('other modes and host adapters see authored identity before the writer flushes', async () => {
  const host = makeLuaDivergenceHost(), gate = pause(), persist = deferred();
  const scope = {};
  const api: HostApi = { ...host.api, luaStateScope: scope, characters: {
    ...host.api.characters, update: async (id, patch) => { await persist.promise; await host.api.characters.update(id, patch); },
  } };
  const writer = await runtime(api, 'start', gate.script);
  const running = writer.runLua(`onStart=async(function(id) setName(id,'Authored'); sleep(id,0):await() end)`);
  await gate.entered.promise;
  const reader = await runtime({ ...host.api, luaStateScope: scope, characters: { ...host.api.characters } }, 'output');
  expect(await reader.runLua(`function onOutput(id) return getName(id)..'|'..cbs('{{char}}') end`)).toBe('Authored|Authored');
  expect(host.character.name).toBe('Character');
  persist.resolve(); gate.release.resolve();
  await running; await writer.flush();
  expect(host.character.name).toBe('Authored');
});

test('a delayed older host notification cannot roll identity back', async () => {
  const host = makeLuaDivergenceHost();
  const writer = await runtime(host.api);
  await writer.runLua(`function onStart(id) setName(id,'First'); setName(id,'Second') end`);
  await writer.flush();
  const gate = pause(), reader = await runtime(host.api, 'output', gate.script);
  const running = reader.runLua(`onOutput=async(function(id) sleep(id,0):await(); return getName(id) end)`);
  await gate.entered.promise;
  characterEvent(host.api, 'First');
  gate.release.resolve();
  expect(await running).toBe('Second');
});

test('an edit during identity hydration cannot be overwritten by the older read', async () => {
  const host = makeLuaDivergenceHost(), reading = deferred(), release = deferred();
  const get = host.api.characters.get;
  let calls = 0;
  host.api.characters.get = async id => {
    const value = await get(id);
    if (++calls === 1) { reading.resolve(); await release.promise; }
    return value;
  };
  const running = prepareLuaHostState(host.api, 'test-character');
  await reading.promise;
  host.character.name = 'Newer';
  characterEvent(host.api, 'Newer');
  release.resolve();
  expect((await running).character?.name).toBe('Newer');
});

test('identity reads remain isolated between operator scopes', async () => {
  const a = makeLuaDivergenceHost(), b = makeLuaDivergenceHost();
  const apiA = { ...a.api, luaStateScope: {} }, apiB = { ...b.api, luaStateScope: {} };
  const first = await runtime(apiA);
  await first.runLua(`function onStart(id) setName(id,'Only A') end`);
  const second = await runtime(apiB, 'output');
  expect(await second.runLua(`function onOutput(id) return getName(id) end`)).toBe('Character');
  await first.flush();
});

test('persona and author-note updates become visible when a suspended callback resumes', async () => {
  const host = makeLuaDivergenceHost(), gate = pause();
  let persona = { id: 'persona', name: 'Before', description: 'First' };
  const api: HostApi = { ...host.api, personas: { getActive: async () => ({ ...persona }), update: async () => {} } };
  host.metadata.authors_note = { content: 'Old note' };
  const rt = await runtime(api, 'start', gate.script);
  const running = rt.runLua(`onStart=async(function(id)
    sleep(id,0):await(); return getPersonaName(id)..'|'..getPersonaDescription(id)..'|'..getAuthorsNote(id)..'|'..cbs('{{user}}')
  end)`);
  await gate.entered.promise;
  persona = { id: 'persona', name: 'After', description: 'Second' };
  host.metadata.authors_note = { content: 'New note' };
  observeLuaHostState(host.api.characters, 'PERSONA_CHANGED', { id: persona.id, persona });
  observeLuaHostState(host.api.characters, 'CHAT_CHANGED', { chat: { id: 'test-chat', metadata: host.metadata }, changedFields: ['metadata.authors_note'] });
  gate.release.resolve();
  expect(await running).toBe('After|Second|New note|After');
});

test('failed persistence drains later writes and still rejects the flush', async () => {
  const host = makeLuaDivergenceHost();
  const update = host.api.characters.update;
  host.api.characters.update = async (id, patch) => {
    if (patch.name === 'Rejected') throw Error('write rejected');
    await update(id, patch);
  };
  const rt = await runtime(host.api);
  await rt.runLua(`function onStart(id) setName(id,'Rejected'); setName(id,'Accepted') end`);
  await expect(rt.flush()).rejects.toThrow('write rejected');
  expect(host.character.name).toBe('Accepted');
  const reader = await runtime(host.api, 'output');
  expect(await reader.runLua(`function onOutput(id) return getName(id) end`)).toBe('Accepted');
});

test('clean execution checks avoid redundant reads but resumption refreshes authoritative state', async () => {
  const host = makeLuaDivergenceHost();
  const get = host.api.characters.get;
  let reads = 0;
  host.api.characters.get = async id => { reads++; return get(id); };
  const state = await prepareLuaHostState(host.api, 'test-character');
  expect(reads).toBe(1);
  await state.synchronize!(); await state.synchronize!();
  expect(reads).toBe(1);
  characterEvent(host.api, 'ignored stale payload');
  await state.synchronize!();
  expect(reads).toBe(2);
  expect(state.character?.name).toBe('Character');
  await state.synchronize!(true);
  expect(reads).toBe(3);
});

test('Lua author notes preserve the legacy host mapping when metadata is empty', async () => {
  const host = makeLuaDivergenceHost();
  host.metadata.chat_variables = { __risu_author_note__: 'Legacy note' };
  host.metadata.authors_note = { content: '' };
  const rt = await runtime(host.api);
  expect(await rt.runLua(`function onStart(id) return getAuthorsNote(id) end`)).toBe('Legacy note');
});

test('removing chat metadata invalidates the prepared author note', async () => {
  const host = makeLuaDivergenceHost();
  host.metadata.authors_note = { content: 'Removed' };
  const state = await prepareLuaHostState(host.api, 'test-character');
  delete host.metadata.authors_note;
  observeLuaHostState(host.api.characters, 'CHAT_CHANGED', { chat: { id: 'test-chat', metadata: null }, changedFields: ['metadata'] });
  await state.synchronize!();
  expect(state.authorsNote).toBe('');
});
