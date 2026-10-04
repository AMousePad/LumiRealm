import { afterEach, expect, test } from 'bun:test';
import { invalidateToggleMacroCache, registerSpindleMacros } from '../../src/interpreter/spindle-macros.js';
import { recordPresetToggleValues, resetPresetToggleValues } from '../../src/state/preset-toggle-values.js';

// The host prompt engine evaluates preset blocks with sourceOwner: "host", so
// LumiRealm's macro interceptor never sees them. `{{risuGlobalVar::…}}` (what
// transformPresetTemplate emits for Risu `{{getglobalvar::…}}`) is therefore the
// only reader for preset-text toggles. These tests pin its value source: the
// preset values the host resolved for this evaluation, then the chat globals,
// then the user's persisted State → Toggles preferences.

type MacroHandler = (ctx: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
afterEach(() => {
  (globalThis as { spindle?: unknown }).spindle = previous;
  invalidateToggleMacroCache();
  resetPresetToggleValues();
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
    // The host adds the chat id to every extension-macro invocation.
    chatId?: string;
    // The macro env carries the same chat id on env.chat.id.
    chat?: { id: string };
  } = {},
): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`macro not registered: ${name}`);
  return Promise.resolve(handler({
    args: [key],
    ...(env.chatId !== undefined ? { chatId: env.chatId } : {}),
    env: {
      ...(env.chat !== undefined ? { chat: env.chat } : {}),
      variables: { global: env.global ?? {}, local: env.local ?? {}, chat: {} },
      extra: {
        ...(env.userId !== undefined ? { userId: env.userId } : {}),
        ...(env.promptVariables !== undefined ? { promptVariables: env.promptVariables } : {}),
      },
    },
  })) as Promise<string>;
}

test('persisted toggle preferences win over the host preset variable snapshot', async () => {
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

// A stored preset whose toggles are declared by the preset itself and a
// preference file that exists but holds none of them: every read used to return
// the literal "null" because the merge dropped every legacy toggle_* entry.
test('stored preset toggles survive a non-empty preference file of unrelated keys', async () => {
  const { handlers } = install({ user: { toggle_from_another_preset: '1', toggle_other: '0' } });
  const presetSnapshot = { toggle_x: 1, toggle_y: '2', words: 500 };
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    global: { toggle_x: '0' },
    promptVariables: presetSnapshot,
    userId: 'user',
  })).toBe('1');
  expect(await call(handlers, 'risuglobalvar', 'toggle_y', {
    promptVariables: presetSnapshot,
    userId: 'user',
  })).toBe('2');
  // A preset variable that is not a toggle stays host-owned.
  expect(await call(handlers, 'risuglobalvar', 'words', {
    promptVariables: presetSnapshot,
    userId: 'user',
  })).toBe('null');
});

test('a persisted preference wins over the preset value', async () => {
  const { handlers } = install({ user: { toggle_x: '0' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    global: { toggle_x: '0' },
    promptVariables: { toggle_x: 1 },
    userId: 'user',
  })).toBe('0');
});

test('a chat-global toggle the preferences hide stays hidden', async () => {
  const { handlers } = install({ user: { toggle_unrelated: '1' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    global: { toggle_x: '1' },
    promptVariables: { toggle_y: '1' },
    userId: 'user',
  })).toBe('null');
});

test('preset values are the lowest overlay layer, below the chat globals', async () => {
  const { handlers } = install({});
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    global: { toggle_x: 'chat' },
    promptVariables: { toggle_x: 'preset' },
    userId: 'user',
  })).toBe('chat');
});

test('the no-userId path keeps reading the snapshot as before', async () => {
  const { handlers } = install({ user: { toggle_x: '0' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', { promptVariables: { toggle_x: 1 } })).toBe('1');
  expect(await call(handlers, 'risuglobalvar', 'toggle_missing', { promptVariables: { toggle_x: 1 } })).toBe('null');
});

test('the snapshot on env.extra wins over the recorded chat snapshot', async () => {
  recordPresetToggleValues('chat', 'user', 'preset-a', { toggle_x: '9' });
  const { handlers } = install({ user: { toggle_unrelated: '1' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    chatId: 'chat',
    promptVariables: { toggle_x: '1' },
    userId: 'user',
  })).toBe('1');
});

test('evaluations without a snapshot fall back to the recorded chat snapshot', async () => {
  recordPresetToggleValues('chat', 'user', 'preset-a', { toggle_x: 1 });
  const { handlers } = install({ user: { toggle_unrelated: '1' } });
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', {
    chatId: 'chat',
    global: { toggle_x: '0' },
    userId: 'user',
  })).toBe('1');
  // env.chat.id is the primary chat source, the wire chatId the fallback.
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', { chat: { id: 'chat' }, userId: 'user' })).toBe('1');
  // The snapshot stays chat scoped, so another chat reads nothing.
  expect(await call(handlers, 'risuglobalvar', 'toggle_x', { chatId: 'other-chat', userId: 'user' })).toBe('null');
});
