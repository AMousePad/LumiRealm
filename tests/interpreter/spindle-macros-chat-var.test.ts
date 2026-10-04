import { afterEach, expect, test } from 'bun:test';
import { invalidateToggleMacroCache, registerSpindleMacros } from '../../src/interpreter/spindle-macros.js';
import { resetAllScriptstateDefaults, setActiveScriptstateDefaults } from '../../src/interpreter/defaults-cache.js';
import { transformPresetTemplate } from '../../src/core/preset/risup-translator.js';

// Preset blocks run in the host engine, which posts env.variables to the worker
// as plain objects. Risu chat variables live on variables.chat, so these tests
// pin the reads of translated {{getvar}} and of $ and @ inside {{? }}.

type MacroHandler = (ctx: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
afterEach(() => {
  (globalThis as { spindle?: unknown }).spindle = previous;
  invalidateToggleMacroCache();
  resetAllScriptstateDefaults();
});

function install(prefs: Record<string, Record<string, string>> = {}): Map<string, MacroHandler> {
  const handlers = new Map<string, MacroHandler>();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (def: { name: string; handler: MacroHandler }) => handlers.set(def.name, def.handler),
    userStorage: {
      getJson: async (_path: string, options: { userId: string }) => prefs[options.userId] ?? null,
      setJson: async () => {},
    },
  };
  registerSpindleMacros();
  return handlers;
}

interface Scopes {
  chat?: Record<string, string | null>;
  global?: Record<string, string>;
  local?: Record<string, string>;
}

function workerContext(args: string[], scopes: Scopes, userId?: string) {
  return {
    args,
    chatId: 'chat-1',
    env: {
      chat: { id: 'chat-1' },
      variables: { local: scopes.local ?? {}, global: scopes.global ?? {}, chat: scopes.chat ?? {} },
      extra: userId === undefined ? {} : { userId },
    },
  };
}

async function run(handlers: Map<string, MacroHandler>, risu: string, scopes: Scopes, userId?: string) {
  const translated = transformPresetTemplate(risu);
  const [name, ...args] = translated.slice(2, -2).split('::');
  const handler = handlers.get(name!);
  if (!handler) throw new Error(`macro not registered: ${translated}`);
  return handler(workerContext(args, scopes, userId));
}

test('translated getvar and calc read the chat variables the worker receives', async () => {
  const handlers = install();
  const scopes = { chat: { x: '2' }, local: { x: 'local' } };
  expect(await run(handlers, '{{getvar::x}}', scopes)).toBe('2');
  expect(await run(handlers, '{{? $x+1}}', scopes)).toBe('3');
});

test('an unset chat variable reads the card default, then Risu null', async () => {
  const handlers = install();
  setActiveScriptstateDefaults('chat-1', 'char-1', { mood: 'calm' });
  const scopes = { chat: { cleared: null } };
  expect(await run(handlers, '{{getvar::mood}}', scopes)).toBe('calm');
  expect(await run(handlers, '{{getvar::cleared}}', scopes)).toBe('null');
  expect(await run(handlers, '{{getvar::missing}}', scopes)).toBe('null');
  expect(await run(handlers, '{{? $missing+1}}', scopes)).toBe('1');
});

test('calc reads @ through the same effective globals as getglobalvar', async () => {
  const handlers = install({ user: { toggle_level: '4' } });
  const scopes = { global: { score: '5', toggle_level: '0' } };
  expect(await run(handlers, '{{? @score+1}}', scopes, 'user')).toBe('6');
  expect(await run(handlers, '{{? @toggle_level*2}}', scopes, 'user')).toBe('8');
  expect(await run(handlers, '{{getglobalvar::toggle_level}}', scopes, 'user')).toBe('4');
});

test('in-process callers passing Maps read the same scopes', async () => {
  const handlers = install();
  const context = {
    args: ['$x+@y'],
    env: { variables: { local: new Map(), global: new Map([['y', '3']]), chat: new Map([['x', '2']]) } },
  };
  expect(await handlers.get('risuCalc')!(context)).toBe('5');
  expect(await handlers.get('risuChatVar')!({ ...context, args: ['x'] })).toBe('2');
});
