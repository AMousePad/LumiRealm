import { afterEach, expect, test } from 'bun:test';
import { invalidateToggleMacroCache, registerSpindleMacros } from '../../src/interpreter/spindle-macros.js';

// The host prompt engine evaluates preset blocks with sourceOwner: "host", so
// LumiRealm's macro interceptor never sees them. `{{risuGlobalVar::…}}` (what
// transformPresetTemplate emits for Risu `{{getglobalvar::…}}`) is therefore the
// only reader for preset-text toggles. These tests pin its value source: the
// user's persisted State → Toggles preferences over the chat globals.

type MacroHandler = (ctx: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
afterEach(() => {
  (globalThis as { spindle?: unknown }).spindle = previous;
  invalidateToggleMacroCache();
});

function install(prefs: Record<string, Record<string, string> | null> = {}) {
  const handlers = new Map<string, MacroHandler>();
  let reads = 0;
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (def: { name: string; handler: MacroHandler }) => {
      handlers.set(def.name.toLowerCase(), def.handler);
    },
    userStorage: {
      getJson: async (_path: string, options: { userId: string }) => {
        reads++;
        return prefs[options.userId] ?? null;
      },
      setJson: async () => {},
    },
  };
  registerSpindleMacros();
  return { handlers, readCount: () => reads };
}

function call(
  handlers: Map<string, MacroHandler>,
  name: string,
  key: string,
  env: {
    global?: Record<string, string>;
    local?: Record<string, string>;
    // The host prompt-variable snapshot coerces per variable type, so it can
    // hold numbers as well as strings.
    promptVariables?: Record<string, unknown>;
    userId?: string;
  } = {},
): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`macro not registered: ${name}`);
  return Promise.resolve(handler({
    args: [key],
    env: {
      variables: { global: env.global ?? {}, local: env.local ?? {}, chat: {} },
      extra: {
        ...(env.userId !== undefined ? { userId: env.userId } : {}),
        ...(env.promptVariables !== undefined ? { promptVariables: env.promptVariables } : {}),
      },
    },
  })) as Promise<string>;
}

test('preset global reads follow persisted toggle preferences, not the host preset variable snapshot', async () => {
  const { handlers } = install({ user: { toggle_episode_display_removal: '1' } });
  const env = {
    global: { toggle_episode_display_removal: '0', ordinary: 'chat' },
    local: { toggle_episode_display_removal: '0' },
    promptVariables: { toggle_episode_display_removal: 0 },
    userId: 'user',
  };
  expect(await call(handlers, 'risuglobalvar', 'toggle_episode_display_removal', env)).toBe('1');
  // Non-toggle globals keep their chat scope.
  expect(await call(handlers, 'risuglobalvar', 'ordinary', env)).toBe('chat');
  // Alias resolves to the same reader.
  expect(await call(handlers, 'lumirealmglobalvar', 'toggle_episode_display_removal', env)).toBe('1');
});

test('uninitialized users fall back to chat globals and unset keys read as null', async () => {
  const { handlers } = install({});
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { global: { toggle_mode: 'legacy' }, userId: 'new' }))
    .toBe('legacy');
  expect(await call(handlers, 'risuglobalvar', 'toggle_missing', { global: { toggle_mode: 'legacy' }, userId: 'new' }))
    .toBe('null');
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { global: { toggle_mode: 'legacy' } }))
    .toBe('legacy');
});

test('toggle reads stay scoped to the resolving user', async () => {
  const { handlers } = install({ alice: { toggle_mode: 'a' }, bob: { toggle_mode: 'b' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'alice' })).toBe('a');
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'bob' })).toBe('b');
});

test('toggles the user never touched come from the initialization snapshot, not a stale chat value', async () => {
  const { handlers } = install({ user: { toggle_check: '1', toggle_text: 'saved' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_check', {
    global: { toggle_check: '0', toggle_text: 'old', ordinary: 'kept' },
    userId: 'user',
  })).toBe('1');
  expect(await call(handlers, 'risuglobalvar', 'ordinary', {
    global: { toggle_check: '0', ordinary: 'kept' },
    userId: 'user',
  })).toBe('kept');
});

test('preference reads are memoized per user and dropped on invalidation', async () => {
  const prefs: Record<string, Record<string, string> | null> = { user: { toggle_mode: '1' } };
  const { handlers, readCount } = install(prefs);
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'user' })).toBe('1');
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'user' })).toBe('1');
  expect(readCount()).toBe(1);
  prefs.user = { toggle_mode: '0' };
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'user' })).toBe('1');
  invalidateToggleMacroCache('user');
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', { userId: 'user' })).toBe('0');
});

test('a failed preference read degrades to chat globals instead of failing the host engine', async () => {
  const { handlers } = install({});
  (globalThis as unknown as { spindle: { userStorage: { getJson: () => Promise<never> } } }).spindle.userStorage = {
    getJson: async () => { throw new TypeError('storage unavailable'); },
  };
  expect(await call(handlers, 'risuglobalvar', 'toggle_mode', {
    global: { toggle_mode: 'legacy' },
    userId: 'user',
  })).toBe('legacy');
});
