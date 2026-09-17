import { describe, expect, test } from 'bun:test';
import { createImportHandlers, type ImportHandlerDeps } from '../../src/handlers/import.js';
import type { HandlerCallCtx } from '../../src/handlers/types.js';
import { createLifecycleEventHandlers, type LifecycleEventHandlerDeps } from '../../src/events/lifecycle.js';

function harness(owned = true, remembered = true, onStyleMode: ImportHandlerDeps['setChatStyleMode'] = () => {}) {
  const trace: string[] = [];
  const active = { ownerUserId: 'user', card: { character_id: 'character', risuPayload: {} } } as never;
  const log = { info() {}, warn() {}, error() {} };
  const deps = {
    lastSentBgHtmlByChat: new Map([['chat', 'previous-css']]),
    activeCardByChat: new Map([['chat', active]]),
    lastActiveChatByUser: new Map(remembered ? [['user', 'chat']] : []),
    hostVersionCheck: { needsUpdate: false },
    getMissingPermissions: () => [],
    listCards: async () => [],
    pushCards() {},
    ensureActiveCardForChat: async () => owned ? active : null,
    sendSetActiveChat: (chatId: string | null) => trace.push(`active:${chatId}`),
    setChatStyleMode: (chatId: string, mode: 'bounded' | 'extension-relaxed', userId: string) => {
      trace.push(`style:${chatId}:${mode}:${userId}`);
      onStyleMode(chatId, mode, userId);
    },
    invalidateRenderMcpForChat() {},
    invalidateMacroInterceptorForChat() {},
    refreshBgHtml: async () => { trace.push('background'); },
    refreshVariables: async () => { trace.push('snapshot'); },
    log,
    errMsg: String,
  } as unknown as ImportHandlerDeps;
  const ctx: HandlerCallCtx = { userId: 'user', send() {}, log, errMsg: String };
  return { trace, deps, load: () => createImportHandlers(deps).get_cards({ type: 'get_cards' }, ctx) };
}

describe('frontend chat rehydration', () => {
  for (const arrival of ['before-connection', 'after-connection', 'after-handshake'] as const) {
    test(`restores layout when the chat-switch claim arrives ${arrival}`, async () => {
      let connected = arrival === 'after-connection';
      const received: string[] = [];
      const h = harness(true, false, (chatId, mode) => {
        if (connected) received.push(`${chatId}:${mode}`);
      });
      let release!: () => void;
      const delayed = new Promise<void>(resolve => { release = resolve; });
      const lifecycle = createLifecycleEventHandlers({
        ...h.deps,
        captureUserId() {},
        dumpPayload: () => '{}',
        chatsGet: async () => {
          if (arrival === 'after-handshake') await delayed;
          return { character_id: 'character' };
        },
        refreshMessagesCache: async () => {},
        refreshToggleDefinitions: async () => {},
      } as unknown as LifecycleEventHandlerDeps);
      const switching = lifecycle.CHAT_SWITCHED({ chatId: 'chat' }, 'user');
      if (arrival !== 'after-handshake') await switching;
      expect(received.length).toBe(arrival === 'after-connection' ? 1 : 0);
      connected = true;
      try {
        await h.load();
        expect(received.at(-1)).toBe('chat:extension-relaxed');
      } finally {
        release();
        await switching;
      }
    });
  }

  test('restores the viewport layout claim on every frontend remount', async () => {
    const h = harness();
    await h.load();
    expect(h.trace).toEqual(['active:chat', 'style:chat:extension-relaxed:user', 'background', 'snapshot']);
    expect(h.deps.lastSentBgHtmlByChat.has('chat')).toBe(false);
    h.trace.length = 0;
    await h.load();
    expect(h.trace).toEqual(['active:chat', 'style:chat:extension-relaxed:user', 'background', 'snapshot']);
  });

  test('does not claim a native chat', async () => {
    const h = harness(false);
    await h.load();
    expect(h.trace).toEqual(['active:null']);
  });

  test('does not guess an active chat when none is remembered', async () => {
    const h = harness(true, false);
    await h.load();
    expect(h.trace).toEqual(['active:null']);
  });
});
