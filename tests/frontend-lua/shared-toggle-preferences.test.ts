import { afterEach, expect, test } from 'bun:test';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { RuntimeServiceCall } from '../../src/frontend-lua/services';
import type { RuntimeConfig, RuntimeStateDto } from '../../src/frontend-lua/state-contract';
import { setupFrontendLua } from '../../src/frontend-lua/frontend';
import { getDisplaySnapshot } from '../../src/display/snapshot';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store';
import { snapshot } from '../helpers/display-lua-fixture';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function fixture(openSecond = true) {
  const configs = new Map<string, RuntimeConfig>();
  const states = new Map<string, RuntimeStateDto>();
  for (const chatId of ['a', 'b']) {
    const code = `function readToggle(id) setChatVar(id,'seen',getGlobalVar(id,'toggle_mode')) end`;
    const config = { ...snapshot(code), chatId, characterId: `character-${chatId}`, configVersion: 1,
      togglePreferences: { toggle_mode: '0' }, presetToggles: { toggle_preset: chatId } };
    config.luaTriggers[0]!.source.effect[0] = { type: 'triggerlua', code };
    configs.set(chatId, config);
    states.set(chatId, {
      revision: { epoch: 'host', sequence: 1 }, chat: { id: chatId, metadata: { chat_variables: { own: chatId }, macro_variables: { global: { toggle_mode: 'legacy' } } } },
      character: { id: config.characterId, world_book_ids: [] }, persona: null, messages: [], lore: [], globalVariables: {},
    });
  }
  const calls: RuntimeServiceCall[] = [], errors: unknown[] = [], invalidations: { chatId: string; reset?: boolean }[] = [];
  const events = new Map<string, (...args: any[]) => void>();
  let runtime!: ReturnType<typeof setupFrontendLua>;
  const ctx = {
    host: { extensionInstallationId: 'this-extension' },
    frontendSessionId: '0123456789abcdef0123456789abcdef', getActiveChat: () => ({ chatId: 'a', characterId: 'character-a' }),
    events: { on: (name: string, handler: (...args: any[]) => void) => { events.set(name, handler); return () => events.delete(name); } }, ui: {}, display: { setExpression() {} },
    sendToBackend(raw: unknown) {
      const call = structuredClone(raw) as RuntimeServiceCall;
      calls.push(call);
      queueMicrotask(() => {
        const state = states.get(call.chatId)!;
        let value: unknown;
        if (call.request.kind === 'bootstrap') value = { state, snapshot: configs.get(call.chatId), settings: DEFAULT_SETTINGS };
        else if (call.request.kind === 'state.write' && call.request.command.kind === 'chat.variables') {
          state.chat.metadata.chat_variables = { ...state.chat.metadata.chat_variables as object, ...call.request.command.values };
          state.revision = { ...state.revision, sequence: state.revision.sequence + 1 };
          value = { revision: state.revision, patch: { chat: state.chat } };
        } else throw new Error('Unexpected runtime service');
        runtime.receive(structuredClone({ type: 'lua_service_reply', requestId: call.requestId, ok: true, value }));
      });
    },
  } as unknown as SpindleFrontendContext;
  runtime = setupFrontendLua(ctx, (chatId, _keys, reset) => invalidations.push({ chatId, ...(reset === undefined ? {} : { reset }) }), error => errors.push(error));
  cleanups.push(() => runtime.dispose());
  await runtime.snapshot(configs.get('a')!);
  if (openSecond) await runtime.snapshot(configs.get('b')!);
  invalidations.length = 0;
  return { runtime, configs, states, calls, errors, invalidations, events, ctx };
}

test('a preference broadcast for an unopened chat updates cached Lua without loading that chat', async () => {
  const f = await fixture();
  const config = { ...f.configs.get('a')!, chatId: 'unopened', characterId: 'foreign-character', configVersion: 3,
    togglePreferences: { toggle_mode: '1' }, presetToggles: { toggle_preset: 'foreign' } };
  expect(f.runtime.receive({ type: 'display_snapshot', snapshot: config })).toBe(false);
  expect(f.runtime.owns('unopened')).toBe(false);
  expect(f.calls.map(call => call.request.kind)).toEqual(['bootstrap', 'bootstrap']);
  expect(f.invalidations).toEqual([{ chatId: 'a', reset: false }, { chatId: 'b', reset: false }]);
  for (const chatId of ['a', 'b']) {
    await f.runtime.manual(chatId, { kind: 'manual', name: 'readToggle' });
    expect(getDisplaySnapshot(chatId)?.vars.local.seen).toBe('1');
    expect(getDisplaySnapshot(chatId)?.vars.local.own).toBe(chatId);
    expect(getDisplaySnapshot(chatId)?.vars.global.toggle_preset).toBe(chatId);
  }
  f.runtime.receive({ type: 'display_snapshot', snapshot: { ...config, configVersion: 4, togglePreferences: {} } });
  f.runtime.receive({ type: 'display_snapshot', snapshot: config });
  await f.runtime.snapshot({ ...f.configs.get('b')!, configVersion: 2 });
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBeUndefined();
  expect(getDisplaySnapshot('b')?.vars.global.toggle_mode).toBeUndefined();
  await f.runtime.snapshot({ ...f.configs.get('a')!, configVersion: 5, togglePreferences: { toggle_mode: '' } });
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('');
  expect(getDisplaySnapshot('b')?.vars.global.toggle_mode).toBe('');
  f.runtime.receive({ type: 'display_snapshot', snapshot: { ...config, configVersion: 6, togglePreferences: null } });
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('legacy');
  expect(getDisplaySnapshot('b')?.vars.global.toggle_mode).toBe('legacy');
  expect(f.errors).toEqual([]);
});

test('a delayed bootstrap cannot restore preferences older than an observed broadcast', async () => {
  const f = await fixture(false);
  const opening = f.runtime.snapshot(f.configs.get('b')!);
  f.runtime.receive({ type: 'display_snapshot', snapshot: { ...f.configs.get('a')!, chatId: 'unopened', configVersion: 8, togglePreferences: { toggle_mode: 'latest' } } });
  await opening;
  expect(getDisplaySnapshot('b')?.vars.global.toggle_mode).toBe('latest');
  expect(getDisplaySnapshot('b')?.vars.global.toggle_preset).toBe('b');
  expect(f.errors).toEqual([]);
});

test('reconnect accepts fresh preferences after the worker configuration counter restarts', async () => {
  const f = await fixture();
  f.runtime.receive({ type: 'display_snapshot', snapshot: { ...f.configs.get('a')!, chatId: 'unopened', configVersion: 100, togglePreferences: { toggle_mode: 'old' } } });
  f.events.get('__ws_close')!({});
  f.configs.set('a', { ...f.configs.get('a')!, configVersion: 1, togglePreferences: { toggle_mode: 'fresh' } });
  f.events.get('__ws_open')!({});
  f.events.get('CONNECTED')!({ userId: 'owner' });
  await Bun.sleep(0);
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('fresh');
  expect(f.errors).toEqual([]);
});

test('worker restart in another document clears cached preferences without a socket reconnect', async () => {
  const f = await fixture(false);
  f.runtime.receive({ type: 'display_snapshot', snapshot: { ...f.configs.get('a')!, chatId: 'unopened', configVersion: 100, togglePreferences: { toggle_mode: 'old' } } });
  f.events.get('SPINDLE_EXTENSION_UNLOADED')?.({ extensionId: 'unrelated-extension' });
  f.events.get('SPINDLE_EXTENSION_LOADED')?.({ extensionId: 'unrelated-extension' });
  expect(f.runtime.owns('a')).toBe(true);
  expect(f.calls).toHaveLength(1);
  f.events.get('SPINDLE_EXTENSION_UNLOADED')?.({ extensionId: 'this-extension' });
  expect(f.runtime.owns('a')).toBe(false);
  for (const [chatId, config] of f.configs) f.configs.set(chatId, { ...config, configVersion: 1, togglePreferences: { toggle_mode: 'fresh' } });
  f.events.get('SPINDLE_EXTENSION_LOADED')?.({ extensionId: 'this-extension' });
  await Bun.sleep(0);
  await f.runtime.snapshot(f.configs.get('b')!);
  for (const chatId of ['a', 'b']) {
    await f.runtime.manual(chatId, { kind: 'manual', name: 'readToggle' });
    expect(getDisplaySnapshot(chatId)?.vars.local.seen).toBe('fresh');
  }
  expect(f.errors).toEqual([]);
});

test('worker reload while offline waits for authenticated reconnect', async () => {
  const f = await fixture(false);
  f.events.get('SPINDLE_EXTENSION_UNLOADED')?.({ extensionId: 'this-extension' });
  f.events.get('__ws_close')!({});
  f.events.get('__ws_open')!({});
  f.events.get('CONNECTED')!({});
  f.events.get('SPINDLE_EXTENSION_LOADED')?.({ extensionId: 'this-extension' });
  expect(f.calls).toHaveLength(1);
  expect(f.runtime.owns('a')).toBe(false);
  f.events.get('CONNECTED')!({ userId: 'owner' });
  await Bun.sleep(0);
  expect(f.calls.map(call => call.request.kind)).toEqual(['bootstrap', 'bootstrap']);
  expect(f.runtime.owns('a')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('authenticated reconnect recovers when the worker loaded event was missed offline', async () => {
  const f = await fixture(false);
  f.events.get('SPINDLE_EXTENSION_UNLOADED')?.({ extensionId: 'this-extension' });
  f.events.get('__ws_close')!({});
  f.configs.set('a', { ...f.configs.get('a')!, togglePreferences: { toggle_mode: 'fresh' } });
  f.events.get('__ws_open')!({});
  f.events.get('CONNECTED')!({ userId: 'owner' });
  await Bun.sleep(0);
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('fresh');
  expect(f.errors).toEqual([]);
});

test('worker readiness replaces an unanswered reconnect bootstrap', async () => {
  const f = await fixture(false);
  f.events.get('SPINDLE_EXTENSION_UNLOADED')?.({ extensionId: 'this-extension' });
  f.events.get('__ws_close')!({});
  const send = f.ctx.sendToBackend;
  const unanswered: RuntimeServiceCall[] = [];
  f.ctx.sendToBackend = raw => { unanswered.push(raw as RuntimeServiceCall); };
  f.events.get('__ws_open')!({});
  f.events.get('CONNECTED')!({ userId: 'owner' });
  expect(unanswered).toHaveLength(1);
  f.ctx.sendToBackend = send;
  f.configs.set('a', { ...f.configs.get('a')!, togglePreferences: { toggle_mode: 'fresh' } });
  f.events.get('SPINDLE_EXTENSION_LOADED')?.({ extensionId: 'this-extension' });
  await Bun.sleep(0);
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('fresh');
  f.runtime.receive({ type: 'lua_service_reply', requestId: unanswered[0]!.requestId, ok: true,
    value: { state: f.states.get('a'), snapshot: { ...f.configs.get('a')!, togglePreferences: { toggle_mode: 'stale' } }, settings: DEFAULT_SETTINGS } });
  await Bun.sleep(0);
  expect(getDisplaySnapshot('a')?.vars.global.toggle_mode).toBe('fresh');
  expect(f.errors).toHaveLength(1);
  expect(String(f.errors[0])).toContain('connection closed');
});
