import { afterEach, expect, test } from 'bun:test';
import { createFrontendHost } from '../../src/frontend-lua/host.js';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import { runtimeDisplaySnapshot } from '../../src/frontend-lua/snapshot.js';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { LOCAL_LORE_KEY, readLocalLore, upsertLocalLore } from '../../src/interpreter/runtime/local-lore.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';
import { clearLuaEngines } from '../helpers/lua-bridge.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { RuntimeStateDto, RuntimeStatePatch } from '../../src/frontend-lua/state-contract.js';

afterEach(clearLuaEngines);

test('Lua load waits for local lore, variable and message writes through the frontend host', async () => {
  const active = { ownerUserId: 'owner', lumirealm: { user_overrides: {} }, card: {
    character_id: 'character', asset_index: {}, emotion_index: {}, risuPayload: { triggers: [], lua_scripts: [], at_actions: [], scriptstate_defaults: {} },
  } } as unknown as ActiveCard;
  const config = { ...assembleRuntimeConfig({ modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false,
    getCompiledLibraries: () => [] }, active, 'chat', 'owner'), togglePreferences: null, presetToggles: {} };
  const dto: RuntimeStateDto = { revision: { epoch: 'host', sequence: 1 }, chat: { id: 'chat', metadata: {} },
    character: { id: 'character', name: 'Aurora', world_book_ids: [] }, persona: null, messages: [], lore: [], globalVariables: {} };
  const state = new FrontendRuntimeState(dto, async command => {
    await new Promise(resolve => setTimeout(resolve, 2));
    let patch: RuntimeStatePatch;
    if (command.kind === 'lore.upsertLocal') {
      dto.chat.metadata[LOCAL_LORE_KEY] = upsertLocalLore(readLocalLore(dto.chat.metadata), command.entry);
      patch = { chat: dto.chat };
    } else if (command.kind === 'chat.variables') {
      dto.chat.metadata.chat_variables = { ...dto.chat.metadata.chat_variables as object, ...command.values };
      patch = { chat: dto.chat };
    } else if (command.kind === 'message.create') {
      const message = { id: command.id, content: command.content, is_user: command.role === 'user', role: command.role, index_in_chat: dto.messages.length };
      dto.messages.push(message); patch = { message };
    } else throw new Error(`Unexpected command: ${command.kind}`);
    dto.revision = { ...dto.revision, sequence: dto.revision.sequence + 1 };
    return structuredClone({ revision: dto.revision, patch, value: undefined });
  }, () => {});
  let queries = 0;
  const host = createFrontendHost(state, () => runtimeDisplaySnapshot(config, state), DEFAULT_SETTINGS, {
    call: async <T>(request: { kind: string }) => {
      expect(request).toEqual({ kind: 'lore.resolve' }); queries++;
      expect(dto.chat.metadata.chat_variables).toMatchObject({ ready: 'yes' });
      expect(readLocalLore(dto.chat.metadata).map(entry => entry.comment)).toEqual(['Local']);
      expect(dto.messages.map(message => message.content)).toEqual(['activation keyword']);
      return [{ content: 'Native resolved lore', role: 'assistant' }] as T;
    }, ui: {}, expression: async () => {}, invalidate() {}, synchronize: async () => {},
  }, []);
  const runtime = await makeRisuTriggerRuntime(host.api, {}, divergenceLuaScriptNS, { ...host.prepareRuntime(), lowLevelAccess: true });
  const result = await runtime.runLua(`probe = async(function(id)
    upsertLocalLoreBook(id, 'Local', 'local {{getvar::ready}}', {alwaysActive=true})
    setChatVar(id, 'ready', 'yes')
    addChat(id, 'user', 'activation keyword')
    local books = loadLoreBooks(id)
    return tostring(#books)..'|'..books[1].data..'|'..books[1].role
  end)`, { entry: 'probe' });
  expect(result).toBe('1|Native resolved lore|char');
  expect(queries).toBe(1);
});
