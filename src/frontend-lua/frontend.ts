import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { DisplaySnapshot } from '../display/snapshot.js';
import { getDisplaySnapshot, setDisplaySnapshot, clearDisplaySnapshot, diffSnapshotVars, snapshotMessagesChanged } from '../display/snapshot.js';
import { MSG_DEP_KEY } from '../interpreter/evaluator/context.js';
import { prepareTriggerSources } from '../interpreter/dispatcher.js';
import { createFrontendLuaReceiver } from './receiver.js';
import { createRuntimeServices, type RuntimeServiceReply } from './services.js';
import { FrontendRuntimeState } from './state.js';
import { createFrontendHost } from './host.js';
import { createFrontendLuaUi } from './ui.js';
import { runtimeDisplaySnapshot } from './snapshot.js';
import { runFrontendLuaOperation } from './executor.js';
import { setDisplayLuaEnvironment } from '../display/lua-runner.js';
import { FrontendLuaUnavailableError, type FrontendLuaCall, type FrontendLuaOperation } from './protocol.js';
import type { RuntimeBootstrap, RuntimeSettings, RuntimeStateDto, RuntimeStatePatch } from './state-contract.js';
import { sameStateValue, type StateRevision } from './ordered-state.js';

type StateEvent = { event: string; payload: Record<string, unknown>; revision: StateRevision; mutationId?: string };
interface Entry { config: DisplaySnapshot; settings: RuntimeSettings; state: FrontendRuntimeState; updates: Promise<void>; lifetime: AbortController }

function displayConfiguration(snapshot: DisplaySnapshot) {
  const { configVersion: _version, vars: _vars, chat: _chat, messagesHost: _messages, ...configuration } = snapshot;
  return configuration;
}

export function setupFrontendLua(ctx: SpindleFrontendContext, invalidate: (chatId: string, keys: string[], resetScripts?: boolean) => void, report: (error: unknown) => void,
  capture?: (chatId: string, event: import('../interpreter/runtime.js').AuxDebugCaptureEvent) => void) {
  const sessionId = (ctx as SpindleFrontendContext & { frontendSessionId?: string }).frontendSessionId;
  if (!sessionId) throw new FrontendLuaUnavailableError('Frontend Lua requires Lumiverse browser session routing');
  const services = createRuntimeServices(request => ctx.sendToBackend(request));
  const entries = new Map<string, Entry>();
  const loading = new Map<string, { characterId: string; promise: Promise<Entry>; events: StateEvent[] }>();
  const cleanups: (() => void)[] = [];
  const ui = createFrontendLuaUi(ctx);
  const localCalls = new Set<AbortController>();
  let connected = true;
  let connectionGeneration = 0;

  function remove(entry: Entry, reason: string): void {
    entry.lifetime.abort(new FrontendLuaUnavailableError(reason));
    entries.delete(entry.state.chatId);
    clearDisplaySnapshot(entry.state.chatId);
  }

  function publish(entry: Entry, keys?: readonly string[]): void {
    if (entries.get(entry.state.chatId) !== entry) return;
    const previous = getDisplaySnapshot(entry.state.chatId);
    const variablesOnly = keys?.every(key => key.startsWith('["vars",') || key.startsWith('["global",'));
    const next = previous && variablesOnly ? { ...previous,
      vars: { local: entry.state.variables(), global: entry.state.globalVariables(), chat: {} } } : runtimeDisplaySnapshot(entry.config, entry.state);
    setDisplaySnapshot(next);
    if (!previous) { invalidate(next.chatId, ['*'], true); return; }
    const changed = diffSnapshotVars(previous, next);
    if (snapshotMessagesChanged(previous, next)) changed.push(MSG_DEP_KEY);
    // Risu retains script results across history/variable changes; host bookkeeping is not a GUI reload.
    const configurationMayChange = !keys || keys.some(key => !['vars', 'global', 'message'].includes(JSON.parse(key)[0]));
    if (configurationMayChange && !sameStateValue(displayConfiguration(previous), displayConfiguration(next))) changed.push('*');
    if (changed.length) invalidate(next.chatId, changed, changed.includes('*'));
  }

  function reload(entry: Entry): void {
    entry.updates = entry.updates.then(async () => {
      const value = await services.call<RuntimeStateDto>(entry.state.chatId, entry.state.characterId, { kind: 'state.read' });
      entry.state.replace(value);
    });
    void entry.updates.catch(report);
  }

  function observe(entry: Entry, { event, payload, revision, mutationId }: StateEvent): void {
    const apply = (patch: RuntimeStatePatch) => entry.state.apply(revision, patch, mutationId);
    const chatId = payload.chatId ?? (payload.chat as { id?: string } | undefined)?.id;
    if (event.startsWith('MESSAGE_') || event === 'CHAT_CHANGED' || event === 'CHAT_DELETED') {
      if (chatId !== entry.state.chatId && payload.id !== entry.state.chatId) return;
      if (event === 'CHAT_DELETED') { remove(entry, 'The Lua chat was deleted'); return; }
      if (event === 'MESSAGE_DELETED') apply({ deletedMessageId: String(payload.messageId) });
      else if (payload.message) apply({ message: payload.message as NonNullable<RuntimeStatePatch['message']> });
      else if (payload.chat) apply({ chat: payload.chat as RuntimeStateDto['chat'] });
      else reload(entry);
    } else if (event === 'CHARACTER_EDITED' && payload.id === entry.state.characterId) {
      const character = payload.character as RuntimeStateDto['character'];
      if (!character) { reload(entry); return; }
      const { extensions, ...value } = character;
      const extra = extensions as Record<string, unknown> | undefined;
      const worldBookIds = Array.isArray(extra?.world_book_ids) ? extra.world_book_ids : typeof extra?.world_book_id === 'string' ? [extra.world_book_id] : [];
      const previous = entry.state.character().worldBookIds ?? [];
      apply({ character: { ...value, world_book_ids: worldBookIds } });
      if (JSON.stringify(previous) !== JSON.stringify(worldBookIds)) reload(entry);
    } else if (event === 'PERSONA_CHANGED') {
      if (payload.id !== entry.state.persona()?.id) return;
      if (payload.persona) apply({ persona: payload.persona as RuntimeStateDto['persona'] });
      else reload(entry);
    } else if (event === 'WORLD_BOOK_ENTRY_CHANGED' || event === 'WORLD_BOOK_ENTRY_DELETED') {
      if (!entry.state.character().worldBookIds?.includes(String(payload.worldBookId))) return;
      if (event === 'WORLD_BOOK_ENTRY_DELETED') apply({ deletedLoreId: String(payload.id) });
      else if (payload.entry) apply({ loreEntry: payload.entry as RuntimeStateDto['lore'][number] });
      else reload(entry);
    } else if (event === 'SETTINGS_UPDATED') {
      const keys = Array.isArray(payload.keys) ? payload.keys : [payload.key];
      if (keys.some(key => key === 'activePersonaId')) reload(entry);
    } else if (event === 'SPINDLE_BATCH_CHANGED' || event === 'WORLD_BOOK_CHANGED' || event === 'WORLD_BOOK_DELETED') reload(entry);
    else if (event === 'CHARACTER_DELETED' && payload.id === entry.state.characterId) {
      remove(entry, 'The Lua character was deleted');
    }
  }

  async function ensure(chatId: string, characterId: string): Promise<Entry> {
    if (!connected) throw new FrontendLuaUnavailableError('The frontend Lua connection is unavailable');
    const existing = entries.get(chatId);
    if (existing?.state.characterId === characterId) return existing;
    const pending = loading.get(chatId);
    if (pending) {
      if (pending.characterId !== characterId) throw new FrontendLuaUnavailableError('The Lua character changed during initialization');
      return pending.promise;
    }
    if (existing) remove(existing, 'The Lua character changed');
    const generation = connectionGeneration;
    const events: StateEvent[] = [];
    const promise = services.call<RuntimeBootstrap>(chatId, characterId, { kind: 'bootstrap' }).then(value => {
      if (!connected || generation !== connectionGeneration) throw new FrontendLuaUnavailableError('The frontend Lua connection closed during initialization');
      let entry: Entry | undefined;
      const state = new FrontendRuntimeState(value.state, (command, mutationId) => services.call(chatId, characterId, { kind: 'state.write', command, mutationId }), keys => {
        if (entry) publish(entry, keys);
      });
      entry = { config: value.snapshot, settings: value.settings, state, updates: Promise.resolve(), lifetime: new AbortController() };
      entries.set(chatId, entry);
      for (const event of events) observe(entry, event);
      publish(entry);
      return entry;
    }).finally(() => { if (loading.get(chatId)?.promise === promise) loading.delete(chatId); });
    loading.set(chatId, { characterId, promise, events });
    return promise;
  }

  function environment(entry: Entry, signal?: AbortSignal) {
    const { chatId, characterId } = entry.state;
    return createFrontendHost(entry.state, () => {
      entry.lifetime.signal.throwIfAborted();
      const snapshot = getDisplaySnapshot(chatId);
      if (!snapshot) throw new FrontendLuaUnavailableError('The Lua display state is unavailable');
      return snapshot;
    }, entry.settings, {
      call: request => services.call(chatId, characterId, request), ui: ui.api(signal),
      expression: async label => { const imageId = entry.config.character.emotionImages[label]?.imageIds[0]; if (imageId) ctx.display!.setExpression({ chatId, characterId, label, imageId }); },
      invalidate: source => invalidate(chatId, ['*'], source !== 'reloadChat' && source !== 'updateChatAt'), synchronize: () => entry.updates,
      ...(capture ? { capture: (event: import('../interpreter/runtime.js').AuxDebugCaptureEvent) => capture(chatId, event) } : {}),
    });
  }
  setDisplayLuaEnvironment(snapshot => {
    const entry = entries.get(snapshot.chatId);
    if (!entry) throw new FrontendLuaUnavailableError('The display Lua runtime is not ready');
    entry.lifetime.signal.throwIfAborted();
    const host = environment(entry);
    const options = host.prepareRuntime();
    // Render arguments may precede persistence; keep that invocation's raw row without publishing it as stored state.
    const view = entry.state.displayChat(snapshot.messagesHost, options.luaChat?.persistence);
    return { api: host.api, options: { ...options, luaSignal: entry.lifetime.signal, luaChat: view.chat,
      preloaded: { ...options.preloaded, messagesRaw: snapshot.messagesHost } },
      async flush() { try { await entry.state.flush(); } finally { view.release(); } } };
  });

  async function run(chatId: string, characterId: string, operation: FrontendLuaOperation, signal: AbortSignal): Promise<unknown> {
    const entry = await ensure(chatId, characterId);
    signal = AbortSignal.any([signal, entry.lifetime.signal]);
    await entry.updates;
    signal.throwIfAborted();
    const host = environment(entry, signal);
    try {
      return await runFrontendLuaOperation(operation, {
        ...host, data: { characterId, characterName: entry.state.character().name ?? '', userName: entry.state.persona()?.name ?? '' },
        compiled: prepareTriggerSources(entry.config.luaTriggers.map(trigger => trigger.source), characterId),
        triggers: entry.config.luaTriggers, atActions: entry.config.atActions,
      }, signal);
    } finally { await entry.state.flush(); publish(entry); }
  }
  let receiver = createFrontendLuaReceiver(sessionId, (call, signal) => run(call.chatId, call.characterId, call.operation, signal), reply => ctx.sendToBackend(reply));
  const eventNames = ['CHAT_CHANGED', 'CHAT_DELETED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED',
    'CHARACTER_EDITED', 'CHARACTER_DELETED', 'PERSONA_CHANGED', 'SETTINGS_UPDATED', 'WORLD_BOOK_CHANGED', 'WORLD_BOOK_DELETED',
    'WORLD_BOOK_ENTRY_CHANGED', 'WORLD_BOOK_ENTRY_DELETED', 'SPINDLE_BATCH_CHANGED'];
  for (const event of eventNames) cleanups.push(ctx.events.on(event, ((raw: unknown, metadata?: { stateRevision?: StateRevision; runtimeMutationId?: string }) => {
    if (!metadata?.stateRevision) {
      for (const entry of entries.values()) remove(entry, 'The host state event is missing its revision');
      report(new FrontendLuaUnavailableError('The host state event is missing its revision')); return;
    }
    const value = { event, payload: raw as Record<string, unknown>, revision: metadata.stateRevision,
      ...(metadata.runtimeMutationId ? { mutationId: metadata.runtimeMutationId } : {}) };
    for (const pending of loading.values()) pending.events.push(value);
    for (const entry of entries.values()) { try { observe(entry, value); } catch (error) { remove(entry, 'The Lua state could not be synchronized'); report(error); } }
  })));
  cleanups.push(ctx.events.on('__ws_close', () => {
    connected = false; receiver.dispose(); services.dispose(); ui.dispose();
    connectionGeneration++; loading.clear();
    for (const controller of localCalls) controller.abort(new FrontendLuaUnavailableError('The frontend Lua connection closed'));
    for (const entry of entries.values()) remove(entry, 'The frontend Lua connection closed');
  }));
  cleanups.push(ctx.events.on('__ws_open', () => {
    connected = true;
    receiver = createFrontendLuaReceiver(sessionId, (call, signal) => run(call.chatId, call.characterId, call.operation, signal), reply => ctx.sendToBackend(reply));
  }));
  return {
    receive(raw: unknown): boolean {
      const message = raw as { type?: string };
      if (message?.type === 'lua_service_reply') { services.receive(raw as RuntimeServiceReply); return true; }
      if (message?.type === 'lua_call' || message?.type === 'lua_cancel') {
        void receiver.receive(raw as FrontendLuaCall).catch(report); return true;
      }
      return false;
    },
    async snapshot(value: DisplaySnapshot): Promise<void> {
      const entry = await ensure(value.chatId, value.characterId);
      if ((value.configVersion ?? 0) < (entry.config.configVersion ?? 0)) return;
      entry.config = value; publish(entry);
    },
    settings(value: RuntimeSettings): void { for (const entry of entries.values()) entry.settings = value; },
    writeback(chatId: string, values: Record<string, string>): void {
      const entry = entries.get(chatId);
      if (!entry) throw new FrontendLuaUnavailableError('The display Lua runtime is not ready');
      entry.state.stageVariables(values);
      void entry.state.flush().catch(report);
    },
    async manual(chatId: string, operation: FrontendLuaOperation): Promise<void> {
      const value = getDisplaySnapshot(chatId);
      if (!value) throw new FrontendLuaUnavailableError('The Lua runtime is not ready for this chat');
      const controller = new AbortController();
      localCalls.add(controller);
      try { await run(chatId, value.characterId, operation, controller.signal); }
      finally { localCalls.delete(controller); }
    },
    owns(chatId: string): boolean { return entries.has(chatId) || loading.has(chatId); },
    dispose(): void {
      connected = false;
      connectionGeneration++; loading.clear();
      for (const controller of localCalls) controller.abort(new FrontendLuaUnavailableError('The frontend Lua runtime stopped'));
      for (const entry of entries.values()) remove(entry, 'The frontend Lua runtime stopped');
      setDisplayLuaEnvironment(undefined); receiver.dispose(); services.dispose(); ui.dispose(); for (const cleanup of cleanups) cleanup();
    },
  };
}
