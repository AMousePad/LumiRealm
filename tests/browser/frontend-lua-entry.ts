import { snapshot } from '../helpers/display-lua-fixture.js';
import { buildPreloaded } from '../../src/display/host-shim.js';
import { setDisplaySnapshot, getDisplaySnapshot, applyVarDelta } from '../../src/display/snapshot.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { runFrontendLuaOperation, type FrontendLuaEnvironment } from '../../src/frontend-lua/executor.js';
import type { HostApi, HostMessage } from '../../src/interpreter/host.js';
import { LuaFactory } from 'wasmoon';
import { GLUE_WASM_DATA_URI } from '../../src/display/_glue-wasm-b64.js';
import jsonLua from '../../src/interpreter/lua-json.lua' with { type: 'text' };
import { frontendRuntime } from '../helpers/frontend-runtime.js';

function check(actual: unknown, expected: unknown) {
  const encode = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  if (encode(actual) !== encode(expected)) throw new Error(JSON.stringify({ actual, expected }));
}

async function run() {
  let reads = 0;
  const forbidden = async (): Promise<never> => { reads++; throw new Error('Unexpected backend state read'); };
  const api: HostApi = {
    chat: { getMessages: forbidden, getMetadata: forbidden, setMetadata: forbidden, editMessage: forbidden,
      deleteMessage: forbidden, sendMessage: forbidden, inject: forbidden },
    characters: { get: forbidden, update: forbidden },
    personas: { getActive: forbidden, update: forbidden },
  };
  function environment(code: string, live?: { messages: HostMessage[]; onRead(): void }): FrontendLuaEnvironment {
    const snap = snapshot(code);
    setDisplaySnapshot(snap);
    return { api, data: { characterId: snap.characterId }, compiled: [], triggers: snap.luaTriggers, atActions: [],
      prepareRuntime: () => ({ chatId: snap.chatId, characterId: snap.characterId, preloaded: buildPreloaded(getDisplaySnapshot(snap.chatId)!), luaTemplate: text => text,
        ...(live ? { luaChat: { messages: live.messages } } : {}),
        luaVariables: {
          get: (key, scope) => {
            if (key === 'gate') live?.onRead();
            return getDisplaySnapshot(snap.chatId)!.vars[scope === 'global' ? 'global' : 'local'][key] ?? 'null';
          },
          set: (key, value) => { applyVarDelta(snap.chatId, 'local', { [key]: value }); return true; },
          flush() {},
        },
      }),
    };
  }
  const signal = new AbortController().signal;
  const code = `listenEdit('editDisplay', function(id, text) setChatVar(id,'saved',id); return text end)
    function onButtonClick(id, value) setChatVar(getChatVar(id,'saved'),'accepted',value) end`;
  const env = environment(code);
  const snap = getDisplaySnapshot(env.prepareRuntime().chatId)!;
  await runEditDisplayChain(snap, 'text', { chatId: snap.chatId, characterId: snap.characterId, messageIndex: 1, isUser: true, depth: 0 }, value => value, () => {});
  await runFrontendLuaOperation({ kind: 'button', value: 'yes' }, env, signal);
  check(getDisplaySnapshot(snap.chatId)!.vars.local.accepted, 'yes');

  const hashEnv = environment(`listenEdit('editRequest', function(id, value)
    for i=1,64 do local h=hash(id,'x'):await(); if #h~=64 then error('hash') end end
    return value
  end)`);
  const samples: number[] = [];
  const production = await frontendRuntime(hashEnv.triggers[0]!.luaCode);
  for (let round = 0; round < 11; round++) {
    const start = performance.now();
    const result = await production.call({ kind: 'edit', mode: 'editRequest', value: [{ role: 'user', content: 'request' }] });
    check(result, [{ role: 'user', content: 'request' }]);
    if (round >= 2) samples.push(performance.now() - start);
  }
  check(reads, 0);
  check(production.calls.map(call => call.request.kind), ['bootstrap']);
  production.runtime.dispose();
  const rawStart = performance.now();
  for (let i = 0; i < 64; i++) await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x'));
  const rawHashMs = performance.now() - rawStart;
  const liveCode = `listenEdit('editRequest', function(id, value)
    local gate = getChatVar(id,'gate')
    hash(id,'pause'):await()
    return getChat(id,0).data
  end)`;
  const liveEntered = Promise.withResolvers<void>();
  const liveMessages: HostMessage[] = [{ id: 'message', content: 'initial', role: 'user' }];
  const liveEnv = environment(liveCode, { messages: liveMessages, onRead: () => liveEntered.resolve() });
  const liveResult = runFrontendLuaOperation({ kind: 'edit', mode: 'editRequest', value: 'input' }, liveEnv, signal);
  await liveEntered.promise;
  liveMessages[0] = { ...liveMessages[0]!, content: 'edited while suspended' };
  check(await liveResult, 'edited while suspended');
  const oracleSource = (globalThis as unknown as { risuOracleSource?: string }).risuOracleSource;
  let risu: { samplesMs: number[]; medianMs: number | undefined } | undefined;
  if (oracleSource) {
    const factory = new LuaFactory(GLUE_WASM_DATA_URI);
    await factory.mountFile('json.lua', jsonLua);
    const chat = { message: [{ role: 'user', data: 'initial' }], scriptstate: {} };
    const oracleEntered = Promise.withResolvers<void>();
    const char = { type: 'character', triggerscript: [{ effect: [{ type: 'triggerlua', code: hashEnv.triggers[0]!.luaCode }] }] };
    const globals = {
      factory, getCurrentChat: () => chat, getCurrentCharacter: () => char, getModuleTriggers: () => [],
      getChatVar: (key: string) => { if (key === 'gate') oracleEntered.resolve(); return 'null'; }, setChatVar: () => {}, getGlobalChatVar: () => 'null',
      v4: () => crypto.randomUUID(), console,
      Buffer: { from: (buffer: ArrayBuffer) => ({ toString: () => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('') }) },
    };
    const oracle = new Function(...Object.keys(globals), oracleSource + '\nluaFactory=factory; return {runLuaEditTrigger,close:()=>{for(const state of ScriptingEngines.values())state.engine?.global.close()}};')(...Object.values(globals));
    const values: number[] = [];
    try {
      for (let round = 0; round < 11; round++) {
        const start = performance.now();
        check(await oracle.runLuaEditTrigger(char, 'editRequest', [{ role: 'user', content: 'request' }]), [{ role: 'user', content: 'request' }]);
        if (round >= 2) values.push(performance.now() - start);
      }
      char.triggerscript[0]!.effect[0]!.code = liveCode;
      const result = oracle.runLuaEditTrigger(char, 'editRequest', 'input');
      await oracleEntered.promise;
      chat.message[0]!.data = 'edited while suspended';
      check(await result, 'edited while suspended');
    } finally { oracle.close(); }
    risu = { samplesMs: values, medianMs: [...values].sort((a, b) => a - b)[4] };
  }
  return { retainedDisplayIdAcrossModes: true, sharedChatDuringAwait: true, backendStateReads: reads, hashCount: 64, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[4], rawHashMs, risu };
}

Object.assign(globalThis, { frontendLuaResult: run() });
