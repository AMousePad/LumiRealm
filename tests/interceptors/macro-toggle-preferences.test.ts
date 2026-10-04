
import { afterEach, expect, test } from 'bun:test';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { resetMacroInterceptorCache } from '../../src/state/macro-interceptor-cache.js';
import { resetListenEditPreloadCache } from '../../src/interpreter/listenedit-preload.js';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from '../../src/interceptors/lumi-hooks.js';

type MacroHandler = (ctx: any) => Promise<{ text: string; touchedVars: string[]; volatile: boolean }>;

let macroInterceptor: MacroHandler | null = null;
const prefs: Record<string, Record<string, string> | null> = { user: { toggle_imgmode: '1', toggle_auto: '0' } };

function install(userId = 'user'): void {
  macroInterceptor = null;
  (globalThis as any).spindle = {
    registerMacroInterceptor(handler: MacroHandler) { macroInterceptor = handler; },
    registerMessageContentProcessor() {},
    registerInterceptor() {},
    registerWorldInfoInterceptor() {},
    registerContextHandler() {},
    generate: { raw: async () => ({ content: '' }) },
    chat: { getMessages: async () => [] },
    chats: { get: async () => ({ metadata: {} }) },
    characters: { get: async () => ({ id: 'character', world_book_ids: [] }) },
    userStorage: {
      getJson: async (_p: string, o: any) => prefs[o.userId] ?? null,
      setJson: async () => {},
    },
  };
  const active = {
    ownerUserId: userId,
    card: { character_id: 'character', risuPayload: { triggers: [], lua_scripts: [], scriptstate_defaults: {}, at_actions: [], extra: {} } },
  } as unknown as ActiveCard;
  createLumiInterceptors({
    activeCardByChat: new Map([['chat', active]]),
    captureUserId() {},
    ensureActiveCardForChat: async () => active,
    getCachedSettingsSync: () => ({ legacyMediaFindings: false }),
    modulesByNamespaceFromCard: () => null,
    resolveReadonly: async (t: string) => t,
    isFeDisplayAuthoritative: () => false,
    log: { info() {}, warn() {}, error() {}, trace() {}, debug() {} },
    errMsg: String,
  } as unknown as CreateLumiInterceptorsDeps).registerAll();
}

afterEach(() => { resetMacroInterceptorCache(); resetListenEditPreloadCache(); delete (globalThis as any).spindle; });

async function resolve(template = '{{getglobalvar::toggle_imgmode}}/{{getglobalvar::toggle_auto}}', userId = 'user') {
  return await macroInterceptor!({
    template,
    env: {
      commit: false,
      names: { user: 'User', char: 'Char' },
      character: { name: 'Char', firstMessage: '', alternateGreetings: [] },
      chat: { id: 'chat', greetingIndex: 0, messageCount: 1, lastMessageId: 0 },
      system: {},
      variables: { local: {}, global: { toggle_imgmode: '0', toggle_auto: '1', other: 'k' }, chat: {} },
      dynamicMacros: {},
      extra: {},
    },
    commit: false,
    phase: 'prompt',
    userId,
  });
}

test('macro interceptor overlays persisted toggles without replacing ordinary globals', async () => {
  prefs.user = { toggle_imgmode: '1', toggle_auto: '0' };
  install();
  expect((await resolve()).text).toBe('1/0');
  expect((await resolve('{{getglobalvar::other}}')).text).toBe('k');
});

test('cached macro output follows preference initialization, edits and deletion', async () => {
  prefs.user = null;
  install();
  expect((await resolve()).text).toBe('0/1');
  prefs.user = { toggle_imgmode: '1', toggle_auto: '' };
  expect((await resolve()).text).toBe('1/');
  prefs.user = { toggle_imgmode: '0', toggle_auto: '0' };
  expect((await resolve()).text).toBe('0/0');
  prefs.user = {};
  expect((await resolve()).text).toBe('null/null');
});

test('macro preferences isolate users and reject owner mismatches', async () => {
  prefs.user = { toggle_imgmode: '1', toggle_auto: '0' };
  prefs.other = { toggle_imgmode: '2', toggle_auto: '1' };
  install();
  expect((await resolve()).text).toBe('1/0');
  install('other');
  expect((await resolve(undefined, 'other')).text).toBe('2/1');
  expect(await resolve()).toBeUndefined();
});

test('preference read errors reject instead of returning stale cached output', async () => {
  prefs.user = { toggle_imgmode: '1', toggle_auto: '0' };
  install();
  await resolve();
  (globalThis as any).spindle.userStorage.getJson = async () => { throw new Error('unavailable'); };
  await expect(resolve()).rejects.toThrow('Toggle preferences could not be read');
});
