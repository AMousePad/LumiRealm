import { describe, test, expect, beforeEach, afterEach, setSystemTime } from 'bun:test';
import {
  createLumiInterceptors,
  type CreateLumiInterceptorsDeps,
} from '../../src/interceptors/lumi-hooks.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { StoredRisuCard } from '../../src/payload/types.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { resetMacroInterceptorCache } from '../../src/state/macro-interceptor-cache.js';
import { resetRenderMcpCache } from '../../src/state/render-mcp-cache.js';
import { resetListenEditPreloadCache } from '../../src/interpreter/listenedit-preload.js';

// Interceptor overrun report: the host abandons a whole interceptor once its
// wall-clock budget passes and keeps the pre-interceptor messages, so an
// overrun ships an un-mutated prompt behind one console error. These tests pin
// the stage report that names which stage ate the budget.

let interceptor: ((messages: unknown[], context: unknown) => Promise<unknown>) | null = null;

function setupSpindle(): void {
  (globalThis as unknown as { spindle: unknown }).spindle = {
    userStorage: { getJson: async () => null },
    registerMacroInterceptor() {},
    registerMessageContentProcessor() {},
    registerInterceptor(handler: typeof interceptor) {
      interceptor = handler;
    },
    registerWorldInfoInterceptor() {},
    registerContextHandler() {},
    generate: { raw: async () => ({ content: '' }) },
    chats: { get: async () => null, update: async () => null },
  };
}

function makeStubActiveCard(characterId = 'char-1'): ActiveCard {
  const card = {
    character_id: characterId,
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    risuPayload: {
      requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      triggers: [],
      lua_scripts: [],
      scriptstate_defaults: {},
      background_html: null,
      module_background_embedding: '',
      utility_bot: false,
      at_actions: [],
      translator_version: '0.0.0',
      extra: {},
    },
  } as unknown as StoredRisuCard;
  return {
    card,
    chatId: 'chat-1',
    ownerUserId: 'user-1',
    characterWorldBookIds: ['book-1'],
    lumirealm: { user_overrides: {}, default_variables_overrides: {} } as unknown as ActiveCard['lumirealm'],
  } as unknown as ActiveCard;
}

interface State {
  warns: string[];
}

function makeDeps(onMessageVarPass?: () => void): { deps: CreateLumiInterceptorsDeps; state: State } {
  const state: State = { warns: [] };
  const deps: CreateLumiInterceptorsDeps = {
    activeCardByChat: new Map([['chat-1', makeStubActiveCard()]]),
    captureUserId: () => {},
    ensureActiveCardForChat: async () => null,
    getCachedSettingsSync: () => DEFAULT_SETTINGS,
    modulesByNamespaceFromCard: () => null,
    resolveReadonly: async (template) => template,
    resolveReadonlyMany: async (templates) => templates,
    runMessageVarPass: async () => {
      onMessageVarPass?.();
    },
    runBinding: async () => ({ stopSending: false }),
    log: {
      info: () => undefined,
      warn: (m) => { state.warns.push(m); },
      error: () => undefined,
      trace: () => undefined,
      debug: () => undefined,
    },
    errMsg: (e) => (e instanceof Error ? e.message : String(e)),
    isFeDisplayAuthoritative: () => false,
    isPromptRegexAuthoritative: () => false,
    dispatchPromptRegex: async (_prebuilt, _scripts, messages) => ({ ok: false, changed: false, messages }),
  };
  return { deps, state };
}

const messages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

beforeEach(() => {
  interceptor = null;
  setupSpindle();
});

afterEach(() => {
  setSystemTime();
  resetMacroInterceptorCache();
  resetRenderMcpCache();
  resetListenEditPreloadCache();
  delete (globalThis as unknown as { spindle?: unknown }).spindle;
});

describe('lumi-hooks interceptor budget report', () => {
  test('warns with the stage breakdown once the host budget is in reach', async () => {
    const t0 = Date.now();
    const { deps, state } = makeDeps(() => {
      setSystemTime(new Date(t0 + 9_000));
    });
    createLumiInterceptors(deps).registerAll();
    expect(interceptor).not.toBeNull();

    const out = (await interceptor!(messages, {
      chatId: 'chat-1',
      characterId: 'char-1',
      userId: 'user-1',
      generationType: 'normal',
      dryRun: false,
    })) as typeof messages;

    const slow = state.warns.filter((m) => m.includes('interceptor slow'));
    expect(slow.length).toBe(1);
    expect(slow[0]).toContain('chat=chat-1');
    expect(slow[0]).toMatch(/total=8\d{3}ms/);
    expect(slow[0]).toContain('host_budget_default=10000ms');
    expect(slow[0]).toMatch(/stages=\[messageVarPass=8\d{3}ms/);
    expect(slow[0]).toContain('editRequest=');
    expect(out.length).toBe(messages.length);
  });

  test('stays quiet when the interceptor fits the budget', async () => {
    const { deps, state } = makeDeps();
    createLumiInterceptors(deps).registerAll();
    await interceptor!(messages, {
      chatId: 'chat-1',
      characterId: 'char-1',
      userId: 'user-1',
      generationType: 'normal',
      dryRun: false,
    });
    expect(state.warns.filter((m) => m.includes('interceptor slow'))).toEqual([]);
  });
});
