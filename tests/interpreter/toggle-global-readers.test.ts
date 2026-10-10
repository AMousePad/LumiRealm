import { afterEach, expect, test } from 'bun:test';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { loadGlobalVars } from '../../src/interpreter/runtime/chat-state.js';
import { preloadForListenEditChain, resetListenEditPreloadCache } from '../../src/interpreter/listenedit-preload.js';
import { buildBackendPipelineInput } from '../../src/interceptors/prompt-regex-apply.js';
import { createReadonlyResolver } from '../../src/state/readonly-resolver.js';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';

const deps = {
  activeCardByChat: new Map(),
  getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
  modulesByNamespaceFromCard: () => null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  errMsg: String,
};
const legacy = { toggle_mode: 'legacy', ordinary: 'chat' };
let preferences: Record<string, Record<string, string>>;
let writes: number;
function install() {
  preferences = { alice: { toggle_mode: 'saved' }, bob: { toggle_mode: 'other' } };
  writes = 0;
  (globalThis as { spindle?: unknown }).spindle = {
    generate: { raw: async () => ({}) },
    chats: { get: async () => ({ metadata: { macro_variables: { global: legacy } } }) },
    chat: { getMessages: async () => [] },
    characters: { get: async () => ({ id: 'character', world_book_ids: [] }) },
    personas: { getActive: async () => null },
    userStorage: {
      getJson: async (_path: string, options: { userId: string }) => preferences[options.userId] ?? null,
      setJson: async () => { writes++; },
    },
  };
}
afterEach(() => {
  resetListenEditPreloadCache();
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('runtime globals overlay only the explicit user without writing during reads', async () => {
  install();
  for (const [userId, value] of [['alice', 'saved'], ['bob', 'other'], ['new', 'legacy']] as const) {
    const host = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId });
    expect(await loadGlobalVars(host)).toEqual({ toggle_mode: value, ordinary: 'chat' });
    const runtime = await makeRisuTriggerRuntime(host, {}, {
      require: async () => ({
        execute: async (_code: string, globals: { getGlobalVar: (id: string, key: string) => string }) =>
          globals.getGlobalVar('trigger', 'toggle_mode'),
      }),
    });
    expect(await runtime.runLua('return getGlobalVar(triggerId, "toggle_mode")')).toBe(value);
  }
  expect(writes).toBe(0);
});

test('prompt and readonly contexts read persisted toggle values', async () => {
  install();
  const input = await buildBackendPipelineInput('chat', 'character', 'alice', deps);
  expect(runPipeline({ ...input, template: '{{getglobalvar::toggle_mode}}' })).toBe('saved');
  const resolver = createReadonlyResolver(deps);
  expect(await resolver.resolveInWorker('{{getglobalvar::toggle_mode}}', 'chat', 'character', 'bob')).toBe('other');
  expect(writes).toBe(0);
});

test('listenEdit cache refreshes preferences on cache hits and separates users', async () => {
  install();
  const alice = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'alice' });
  expect((await preloadForListenEditChain(alice, 'chat', 'character')).globalVars?.toggle_mode).toBe('saved');
  preferences.alice = { toggle_mode: 'updated' };
  expect((await preloadForListenEditChain(alice, 'chat', 'character')).globalVars?.toggle_mode).toBe('updated');
  const bob = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'bob' });
  expect((await preloadForListenEditChain(bob, 'chat', 'character')).globalVars?.toggle_mode).toBe('other');
});

test('runtime and preload reject preference read failures', async () => {
  install();
  (globalThis as unknown as { spindle: { userStorage: unknown } }).spindle.userStorage = {
    getJson: async () => { throw new TypeError('storage unavailable'); },
  };
  const host = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'alice' });
  const resolver = createReadonlyResolver(deps);
  await expect(resolver.resolve('template', 'chat', 'character', 'alice')).rejects.toThrow('storage unavailable');
  await expect(resolver.resolveMany(['template'], 'chat', 'character', 'alice')).rejects.toThrow('storage unavailable');
  await expect(loadGlobalVars(host)).rejects.toThrow('storage unavailable');
  await expect(preloadForListenEditChain(host, 'chat', 'character')).rejects.toThrow('storage unavailable');
});
