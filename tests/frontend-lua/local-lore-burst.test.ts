import { expect, test } from 'bun:test';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import { persistLocalLore, type LocalLoreHost } from '../../src/state/local-lore.js';
import { LOCAL_LORE_KEY, readLocalLore } from '../../src/interpreter/runtime/local-lore.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';

test('a synchronous burst retains immediate reads and persists every local entry in order', async () => {
  let metadata: Record<string, unknown> = {};
  let sequence = 1, conflicts = 0;
  const host = { contracts: { worldInfoAdditionalEntries: 1 }, chats: {
    get: async () => ({ id: 'chat', metadata: structuredClone(metadata) }),
    compareAndSetMetadata: async (_chatId: string, input: { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> }) => {
      if (JSON.stringify(input.expected_metadata) !== JSON.stringify(metadata)) { conflicts++; return null; }
      metadata = structuredClone(input.metadata);
      return { id: 'chat', metadata: structuredClone(metadata) };
    },
  } } as unknown as LocalLoreHost;
  const state = new FrontendRuntimeState({ revision: { epoch: 'host', sequence }, chat: { id: 'chat', metadata },
    character: { id: 'character' }, persona: null, messages: [], lore: [], globalVariables: {},
  }, async command => {
    if (command.kind !== 'lore.upsertLocal') throw new Error('Unexpected command');
    const chat = await persistLocalLore(host, 'chat', 'owner', command.entry);
    return { revision: { epoch: 'host', sequence: ++sequence }, patch: { chat }, value: undefined };
  }, () => {});
  const fixture = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime(fixture.api, {}, divergenceLuaScriptNS, {
    characterId: fixture.character.id, binding: 'manual', preloaded: fixture.preloaded,
    localLore: { get: () => readLocalLore({ [LOCAL_LORE_KEY]: state.metadata(LOCAL_LORE_KEY) }),
      async upsert(entry) { await state.write({ kind: 'lore.upsertLocal', entry }); } },
  });
  await runtime.runLua(`function onButtonClick(id)
    for i=0,23 do
      upsertLocalLoreBook(id,tostring(i),'entry '..i,{alwaysActive=true})
      assert(#getLoreBooks(id,tostring(i)) == 1)
    end
  end`);
  expect(readLocalLore({ [LOCAL_LORE_KEY]: state.metadata(LOCAL_LORE_KEY) })).toHaveLength(24);
  await runtime.flush();
  await state.flush();
  expect(conflicts).toBe(0);
  expect(readLocalLore(metadata).map(entry => entry.comment)).toEqual(Array.from({ length: 24 }, (_, index) => String(index)));
});
