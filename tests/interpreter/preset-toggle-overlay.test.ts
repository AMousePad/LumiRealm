import { afterEach, expect, test } from 'bun:test';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { loadGlobalVars } from '../../src/interpreter/runtime/chat-state.js';
import { buildBackendPipelineInput } from '../../src/interceptors/prompt-regex-apply.js';
import { createReadonlyResolver } from '../../src/state/readonly-resolver.js';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { recordPresetToggleValues, resetPresetToggleValues } from '../../src/state/preset-toggle-values.js';

const deps = {
  activeCardByChat: new Map(),
  getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
  modulesByNamespaceFromCard: () => null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  errMsg: String,
};
let writes = 0;

function install() {
  writes = 0;
  (globalThis as { spindle?: unknown }).spindle = {
    generate: { raw: async () => ({}) },
    chats: { get: async () => ({ metadata: { macro_variables: { global: { ordinary: 'chat' } } } }) },
    chat: { getMessages: async () => [] },
    characters: { get: async () => ({ id: 'character', world_book_ids: [] }) },
    personas: { getActive: async () => null },
    userStorage: {
      getJson: async (_path: string, options: { userId: string }) => ({ alice: { toggle_mode: 'saved' }, bob: { toggle_mode: 'other' } })[options.userId] ?? null,
      setJson: async () => { writes++; },
    },
  };
}

const TOGGLE = 'toggle_preset_mode';

afterEach(() => {
  resetPresetToggleValues();
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('records the host preset snapshot once and exposes it to every global reader', async () => {
  install();
  recordPresetToggleValues('chat', 'alice', 'preset-a', { [TOGGLE]: 1, words: 500, ordinary: 'preset' });

  const host = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'alice' });
  const globals = await loadGlobalVars(host);
  expect(globals[TOGGLE]).toBe('1');
  expect(globals.ordinary).toBe('chat');
  expect(globals.words).toBeUndefined();

  const runtime = await makeRisuTriggerRuntime(host, {}, {
    require: async () => ({
      execute: async (_code: string, luaGlobals: { getGlobalVar: (id: string, key: string) => string }) =>
        luaGlobals.getGlobalVar('trigger', TOGGLE),
    }),
  });
  expect(await runtime.runLua(`return getGlobalVar(triggerId, "${TOGGLE}")`)).toBe('1');

  const input = await buildBackendPipelineInput('chat', 'character', 'alice', deps);
  expect(runPipeline({ ...input, template: `{{getglobalvar::${TOGGLE}}}` })).toBe('1');

  const resolver = createReadonlyResolver(deps);
  expect(await resolver.resolveInWorker(`{{getglobalvar::${TOGGLE}}}`, 'chat', 'character', 'alice')).toBe('1');
  expect(writes).toBe(0);
});

test('a chat without a recorded preset snapshot keeps the toggle missing', async () => {
  install();
  recordPresetToggleValues('other-chat', 'alice', 'preset-a', { [TOGGLE]: 1 });
  const host = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'alice' });
  expect((await loadGlobalVars(host))[TOGGLE]).toBeUndefined();

  const input = await buildBackendPipelineInput('chat', 'character', 'alice', deps);
  expect(runPipeline({ ...input, template: `{{getglobalvar::${TOGGLE}}}` })).toBe('null');
  expect(writes).toBe(0);
});
