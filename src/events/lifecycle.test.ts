import { describe, expect, test } from 'bun:test';

import { createLifecycleEventHandlers, type LifecycleEventHandlerDeps } from './lifecycle.js';

type RefreshBgHtml = LifecycleEventHandlerDeps['refreshBgHtml'];

function harness(options: {
  active?: boolean;
  chatsGet?: LifecycleEventHandlerDeps['chatsGet'];
  refreshBgHtml?: RefreshBgHtml;
} = {}) {
  const trace: string[] = [];
  const activeCard = {
    card: {
      character_id: 'ch1',
      risuPayload: { background_html: null, triggers: [] },
    },
    ownerUserId: 'u1',
  } as never;
  const deps: LifecycleEventHandlerDeps = {
    captureUserId: (userId, where) => trace.push(`capture:${where}:${userId ?? '-'}`),
    extractIds: () => ({ chatId: null, characterId: null }),
    dumpPayload: () => '{}',
    recompileDerivedPayload: async (characterId) => { trace.push(`recompile:${characterId}`); },
    activeCardByChat: new Map(),
    lastActiveChatByUser: new Map(),
    lastSentBgHtmlByChat: new Map(),
    compiledByCharacter: new Map(),
    worldBookIdsByCharacter: new Map(),
    variableState: { clearChat: () => {} },
    toggleState: { clearChat: () => {} },
    ensureActiveCardForChat: async (chatId, characterId, userId) => {
      trace.push(`active:${chatId}:${characterId ?? '-'}:${userId ?? '-'}`);
      return options.active === false ? null : activeCard;
    },
    invalidateActiveForCharacter: () => {},
    invalidateRenderMcpForChat: (chatId) => trace.push(`render:${chatId}`),
    invalidateRenderMcpForMessage: () => {},
    invalidateMacroInterceptorForChat: (chatId) => trace.push(`macro:${chatId}`),
    invalidateListenEditPreload: () => {},
    refreshMessagesCache: async (chatId, userId) => {
      trace.push(`messages:${chatId}:${userId ?? '-'}`);
    },
    invalidateMessagesCache: () => {},
    clearActiveAssetIndexes: () => {},
    clearActiveCharacterImage: () => {},
    clearActiveScriptstateDefaults: () => {},
    clearActiveLorebook: () => {},
    clearVarOverlay: () => {},
    refreshPersonaImage: async (userId) => { trace.push(`persona:${userId}`); },
    refreshBgHtml: options.refreshBgHtml ?? (async (_active, chatId, userId) => {
      trace.push(`bg:${chatId}:${userId ?? '-'}`);
    }),
    refreshVariables: async (_active, chatId, userId, opts) => {
      trace.push(`variables:${chatId}:${userId ?? '-'}:${opts?.force === true}`);
    },
    refreshToggleDefinitions: async (_active, chatId, userId, opts) => {
      trace.push(`toggles:${chatId}:${userId ?? '-'}:${opts?.force === true}`);
    },
    runBinding: async () => ({ stopSending: false }),
    runMessageVarPass: async () => {},
    generationEndedBindings: [],
    consumeOwnChatChange: () => false,
    consumeOwnCharacterEdit: () => false,
    consumeIfOurWrite: () => false,
    send: (msg, userId) => {
      if (msg.type === 'clear_bg_html') trace.push(`clear:${msg.chatId}:${userId ?? '-'}`);
    },
    sendSetActiveChat: (chatId, characterId, userId) => {
      trace.push(`frontend:${chatId ?? '-'}:${characterId ?? '-'}:${userId ?? '-'}`);
    },
    setChatStyleMode: (chatId, mode, userId) => trace.push(`style:${chatId}:${mode}:${userId ?? '-'}`),
    listCards: async () => [],
    pushCards: () => {},
    deleteCardByChar: async () => {},
    journalStorage: () => ({}) as never,
    readImageJournalFile: async () => null,
    clearImageJournal: async () => {},
    buildLiveImageIdSet: async () => ({ liveIds: new Set<string>() }),
    buildOrphanDetectDepsExcluding: () => ({}) as never,
    deleteImageIds: async () => ({ deleted: 0, absent: 0, failed: 0 }),
    emitOperationProgress: () => {},
    chatsGet: options.chatsGet ?? (async (chatId, userId) => {
      trace.push(`chat:${chatId}:${userId ?? '-'}`);
      return { character_id: 'ch1' };
    }),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: String,
  };
  return { deps, trace, handlers: createLifecycleEventHandlers(deps) };
}

describe('CHAT_SWITCHED lifecycle', () => {
  test('runs the supported dual-event transition exactly once and refreshes messages', async () => {
    const h = harness();
    await h.handlers.SETTINGS_UPDATED({ key: 'activeChatId', value: 'c1' }, 'u1');
    await h.handlers.CHAT_SWITCHED({ chatId: 'c1' }, 'u1');

    expect(h.trace).toEqual([
      'capture:SETTINGS_UPDATED:u1',
      'capture:CHAT_SWITCHED:u1',
      'chat:c1:u1',
      'active:c1:ch1:u1',
      'frontend:c1:ch1:u1',
      'style:c1:extension-relaxed:u1',
      'render:c1',
      'macro:c1',
      'messages:c1:u1',
      'variables:c1:u1:true',
      'toggles:c1:u1:true',
      'bg:c1:u1',
    ]);
  });

  test('ignores activeChatId settings writes', async () => {
    const h = harness();
    await h.handlers.SETTINGS_UPDATED({ key: 'activeChatId', value: 'c1' }, 'u1');
    expect(h.trace).toEqual(['capture:SETTINGS_UPDATED:u1']);
  });

  test('clears the previous chat on a null switch', async () => {
    const h = harness();
    h.deps.lastActiveChatByUser.set('u1', 'old');
    h.deps.lastSentBgHtmlByChat.set('old', 'memo');

    await h.handlers.CHAT_SWITCHED({ chatId: null }, 'u1');

    expect(h.trace).toEqual([
      'capture:CHAT_SWITCHED:u1',
      'frontend:-:-:u1',
      'clear:old:u1',
    ]);
    expect(h.deps.lastActiveChatByUser.has('u1')).toBe(false);
    expect(h.deps.lastSentBgHtmlByChat.has('old')).toBe(false);
  });

  test('clears display state without refreshing a vanilla chat', async () => {
    const h = harness({ active: false });
    await h.handlers.CHAT_SWITCHED({ chatId: 'c1' }, 'u1');

    expect(h.trace).toEqual([
      'capture:CHAT_SWITCHED:u1',
      'chat:c1:u1',
      'active:c1:ch1:u1',
      'frontend:-:-:u1',
      'clear:c1:u1',
    ]);
  });

  test('keeps active-persona refresh on SETTINGS_UPDATED', async () => {
    const h = harness();
    h.deps.lastActiveChatByUser.set('u1', 'c1');
    await h.handlers.SETTINGS_UPDATED({ key: 'activePersonaId', value: 'p1' }, 'u1');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(h.trace).toEqual([
      'capture:SETTINGS_UPDATED:u1',
      'capture:SETTINGS_UPDATED activePersonaId:u1',
      'persona:u1',
      'active:c1:-:u1',
      'render:c1',
      'macro:c1',
      'variables:c1:u1:true',
      'bg:c1:u1',
    ]);
  });

  test('does not publish an older switch after a newer switch completes', async () => {
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const firstResult = new Promise<{ character_id: string }>((resolve) => {
      releaseFirst = () => resolve({ character_id: 'ch1' });
    });
    const h = harness({
      chatsGet: async (chatId) => {
        if (chatId === 'c1') {
          enterFirst();
          return firstResult;
        }
        return { character_id: 'ch1' };
      },
    });

    const first = h.handlers.CHAT_SWITCHED({ chatId: 'c1' }, 'u1');
    await firstEntered;
    await h.handlers.CHAT_SWITCHED({ chatId: 'c2' }, 'u1');
    releaseFirst();
    await first;

    expect(h.trace.filter((entry) => entry.startsWith('frontend:'))).toEqual([
      'frontend:c2:ch1:u1',
    ]);
    expect(h.trace.some((entry) => /^(style|render|macro|messages|variables|toggles|bg):c1/.test(entry))).toBe(false);
    expect(h.deps.lastActiveChatByUser.get('u1')).toBe('c2');
  });

  test('does not publish stale background output', async () => {
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const trace: string[] = [];
    const h = harness({
      refreshBgHtml: async (_active, chatId, userId, isCurrent) => {
        if (chatId === 'c1') {
          enterFirst();
          await firstRelease;
        }
        if (isCurrent?.() ?? true) trace.push(`bg:${chatId}:${userId ?? '-'}`);
      },
    });

    const first = h.handlers.CHAT_SWITCHED({ chatId: 'c1' }, 'u1');
    await firstEntered;
    await h.handlers.CHAT_SWITCHED({ chatId: 'c2' }, 'u1');
    releaseFirst();
    await first;

    expect(trace).toEqual(['bg:c2:u1']);
  });
});
