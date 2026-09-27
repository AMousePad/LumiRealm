import { setup } from '../../src/frontend';
import { clearDisplaySnapshot, getDisplaySnapshot, setDisplayResolutionMode } from '../../src/display/snapshot';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store';
// @ts-expect-error The harness resolves React from the selected host checkout.
import { createElement, useLayoutEffect } from 'react';
// @ts-expect-error The harness resolves React from the selected host checkout.
import { createRoot } from 'react-dom/client';
// @ts-expect-error The harness resolves React from the selected host checkout.
import { flushSync } from 'react-dom';
// @ts-expect-error This module is supplied by LUMIVERSE_DIR at bundle time.
import { useDisplayRegexState, invalidateDisplayRegexCache, invalidateDisplayRegexCacheForVars, resetDisplayRegexCachesForTests } from '@host/hooks/useDisplayRegex';

const env = globalThis as any;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const clone = (value: any) => structuredClone(value);

env.__runDisplayHost = async () => {
  const fixture = clone(env.__fixture), snap = fixture.snap;
  let receive: (value: any) => void = () => {};
  const listeners = new Map<string, Set<(value: any, metadata?: any) => void>>();
  const pendingWrites: any[] = [], requests: string[] = [];
  let bodyCalls = 0, regexCalls = 0, active = 0, writeCalls = 0;
  const outputs = new Map<string, { content: string; pending: boolean }>();
  const durable = { ...snap.vars.local };
  let revision = 1;
  env.__hostState = {
    activeChatId: snap.chatId, activeCharacterId: snap.characterId,
    activeGroupCharacterId: null, activePersonaId: null,
    messages: snap.messagesHost.map((m: any) => ({ ...m, is_user: m.role === 'user' })),
    regexScripts: [...new Map(fixture.inputs.flatMap((row: any) => row.scripts.map((s: any) => [s.id, s]))).values()],
  };
  const nativeFetch = window.fetch;
  window.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('data:')) return nativeFetch(input, init);
    requests.push(String(input)); throw Error('Unexpected rendering network request');
  }) as typeof window.fetch;
  setDisplayResolutionMode('on'); clearDisplaySnapshot(snap.chatId); resetDisplayRegexCachesForTests();
  const dispose = setup({
    frontendSessionId: '0123456789abcdef0123456789abcdef',
    getActiveChat: () => ({ chatId: snap.chatId, characterId: snap.characterId }),
    deferReady() {}, ready() {}, dom: { addStyle: () => () => {} },
    events: { on(name: string, fn: any) {
      const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn);
    } },
    display: {
      registerResolver(resolver: any) {
        env.__hostResolver = new Proxy(resolver, { get(target, key) {
          if (!['resolveBody', 'applyScripts', 'resolveTemplates'].includes(String(key))) return target[key];
          return async (args: any) => {
            if (key === 'resolveBody') bodyCalls++;
            if (key === 'applyScripts') regexCalls++;
            active++;
            try { return await target[key](args); } finally { active--; }
          };
        } });
        return () => { env.__hostResolver = null; };
      },
      invalidate(keys: string[]) {
        if (keys.includes('*')) invalidateDisplayRegexCache();
        else invalidateDisplayRegexCacheForVars(new Set(keys));
      }, setExpression() {},
    },
    sendToBackend(message: any) {
      if (message.type !== 'lua_service') return;
      queueMicrotask(() => {
        let value: any;
        const request = message.request;
        if (request.kind === 'bootstrap') value = { snapshot: snap, settings: DEFAULT_SETTINGS,
          state: { revision: { epoch: 'host', sequence: revision }, chat: { id: snap.chatId, metadata: { chat_variables: { ...durable }, macro_variables: { global: snap.vars.global }, activeGreetingIndex: 0 } },
            character: { id: snap.characterId, name: snap.charName, first_mes: snap.character.firstMessage, world_book_ids: [] },
            persona: { id: 'persona', name: snap.userName }, lore: [], globalVariables: snap.vars.global,
            messages: snap.messagesHost.map((message: any, index_in_chat: number) => ({ ...message, index_in_chat })) } };
        else if (request.kind === 'state.write' && request.command.kind === 'chat.variables') {
          writeCalls++;
          const changed = Object.keys(request.command.values).filter(key => durable[key] !== request.command.values[key]);
          Object.assign(durable, request.command.values);
          const chat = { id: snap.chatId, metadata: { chat_variables: { ...durable }, macro_variables: { global: snap.vars.global }, activeGreetingIndex: 0 } };
          const stateRevision = { epoch: 'host', sequence: ++revision };
          value = { revision: stateRevision, patch: { chat } };
          pendingWrites.push({ chat, changed, metadata: { stateRevision, runtimeMutationId: request.mutationId } });
        } else throw Error('Unexpected runtime service: ' + request.kind);
        receive({ type: 'lua_service_reply', requestId: message.requestId, ok: true, value: clone(value) });
      });
    },
    onBackendMessage(fn: any) { receive = fn; return () => {}; },
  } as any);
  receive({ type: 'cards_updated', cards: [] });
  receive({ type: 'set_active_chat', chatId: snap.chatId, characterId: snap.characterId });
  receive({ type: 'display_snapshot', snapshot: snap });
  while (!getDisplaySnapshot(snap.chatId)) await frame();
  const mount = document.createElement('div'); document.body.append(mount);
  const root = createRoot(mount);
  function Message({ row }: any) {
    const result = useDisplayRegexState(row.raw, row.context.isUser, row.context.depth, undefined, {
      chatId: snap.chatId, messageId: row.context.messageId, role: row.context.role,
    });
    useLayoutEffect(() => { outputs.set(row.context.messageId, result); });
    return createElement('output', null, result.content);
  }
  const settle = async () => {
    for (let i = 0; i < 600; i++) {
      await frame();
      if (active || outputs.size !== fixture.inputs.length || [...outputs.values()].some(v => v.pending)) continue;
      const calls = bodyCalls + regexCalls;
      await frame(); await frame();
      if (!active && calls === bodyCalls + regexCalls && [...outputs.values()].every(v => !v.pending)) return;
    }
    throw Error('Display did not settle');
  };
  const notify = (vars: any, keys: string[], metadata = { stateRevision: { epoch: 'host', sequence: ++revision } }) => {
    const payload = { chat: { id: snap.chatId, character_id: snap.characterId, metadata: { chat_variables: vars, macro_variables: { global: snap.vars.global }, activeGreetingIndex: 0 } },
      changedFields: ['metadata.chat_variables', ...keys.map(key => 'metadata.chat_variables.' + key)] };
    invalidateDisplayRegexCacheForVars(new Set(keys.map(key => 'chat:' + key)));
    for (const fn of listeners.get('CHAT_CHANGED') ?? []) fn(payload, metadata);
  };
  const drain = async () => {
    let rounds = 0;
    while (pendingWrites.length && rounds < 8) {
      const writes = pendingWrites.splice(0); rounds++;
      for (const write of writes) {
        if (write.changed.length) notify(write.chat.metadata.chat_variables, write.changed, write.metadata);
      }
      await settle();
    }
    return { rounds, stoppedAtLimit: pendingWrites.length > 0 };
  };
  try {
    const start = performance.now();
    flushSync(() => root.render(createElement('div', null, fixture.inputs.map((row: any) => createElement(Message, { key: row.context.messageId, row })))));
    await settle();
    const opening = { ...(await drain()), bodyCalls, regexCalls, writeCalls, ms: performance.now() - start };
    pendingWrites.length = 0;
    const clickStart = performance.now(), beforeClick = bodyCalls;
    durable.panelExpanded = durable.panelExpanded === 'true' ? 'false' : 'true';
    notify({ ...durable }, ['panelExpanded']);
    await settle();
    const click = { ...(await drain()), bodyCalls: bodyCalls - beforeClick, ms: performance.now() - clickStart };
    pendingWrites.length = 0;
    const beforeReload = bodyCalls;
    receive({ type: 'display_snapshot', snapshot: clone(getDisplaySnapshot(snap.chatId)), reason: 'gui-reload' });
    await settle();
    return { opening, click, reloadCalls: bodyCalls - beforeReload, requests,
      outputs: [...outputs], finalVars: clone(getDisplaySnapshot(snap.chatId)!.vars.local) };
  } finally {
    root.unmount(); mount.remove(); dispose(); clearDisplaySnapshot(snap.chatId); window.fetch = nativeFetch;
  }
};
