import { afterEach, expect, test } from 'bun:test';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { resetMacroInterceptorCache } from '../../src/state/macro-interceptor-cache.js';
import { resetPresetToggleValues } from '../../src/state/preset-toggle-values.js';
import { resetListenEditPreloadCache } from '../../src/interpreter/listenedit-preload.js';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from '../../src/interceptors/lumi-hooks.js';

type MacroHandler = (ctx: unknown) => Promise<{ text: string; touchedVars: string[]; volatile: boolean }>;

let macroInterceptor: MacroHandler | null = null;

function install(userId = 'user'): void {
  macroInterceptor = null;
  (globalThis as { spindle?: unknown }).spindle = {
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
      getJson: async () => ({ toggle_other: '1' }),
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

function resolve(template: string, extra: Record<string, unknown>, userId = 'user', sourceHint?: string) {
  return macroInterceptor!({
    template,
    env: {
      commit: false,
      names: { user: 'User', char: 'Char' },
      character: { name: 'Char', firstMessage: '', alternateGreetings: [] },
      chat: { id: 'chat', greetingIndex: 0, messageCount: 1, lastMessageId: 0 },
      system: {},
      variables: { local: {}, global: {}, chat: {} },
      dynamicMacros: {},
      extra,
    },
    commit: false,
    phase: 'prompt',
    ...(sourceHint ? { sourceHint } : {}),
    userId,
  });
}

const TOGGLE = 'toggle_episode_display_removal';

afterEach(() => {
  resetMacroInterceptorCache();
  resetListenEditPreloadCache();
  resetPresetToggleValues();
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('prompt variables resolved by the host for the chat preset reach later reads', async () => {
  install();
  const prompt = await resolve(`{{getglobalvar::${TOGGLE}}}`, {
    presetId: 'preset-a',
    promptVariables: { [TOGGLE]: 1, words: 500 },
  }, 'user', 'prompt_source:character.description');
  expect(prompt.text).toBe('1');
  // A display-phase env carries no preset snapshot and must not clear the record.
  const display = await resolve(`{{? {{getglobalvar::${TOGGLE}}}=0}}`, {});
  expect(display.text).toBe('0');
});

test('a preset without the toggle leaves the key missing and drops the previous preset values', async () => {
  install();
  await resolve(`{{getglobalvar::${TOGGLE}}}`, { presetId: 'preset-a', promptVariables: { [TOGGLE]: 1 } });
  await resolve(`{{getglobalvar::${TOGGLE}}}`, { presetId: 'preset-b', promptVariables: { words: 800 } });
  expect((await resolve(`{{getglobalvar::${TOGGLE}}}`, {})).text).toBe('null');
});

test('persisted preferences and chat globals win over the preset value', async () => {
  install();
  await resolve(`{{getglobalvar::toggle_other}}`, { presetId: 'preset-a', promptVariables: { toggle_other: 0 } });
  expect((await resolve('{{getglobalvar::toggle_other}}', {})).text).toBe('1');
});

test('a snapshot recorded for one user stays invisible to another user of the same chat', async () => {
  install();
  await resolve(`{{getglobalvar::${TOGGLE}}}`, { presetId: 'preset-a', promptVariables: { [TOGGLE]: 1 } });
  install('other');
  expect((await resolve(`{{getglobalvar::${TOGGLE}}}`, {}, 'other')).text).toBe('null');
});
