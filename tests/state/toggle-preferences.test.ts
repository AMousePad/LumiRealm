import { afterEach, expect, test } from 'bun:test';
import { createVariablesTogglesService } from '../../src/state/variables-toggles.js';
import { VariableStateStore } from '../../src/state/variables-state.js';
import { ToggleStateStore } from '../../src/state/toggle-state.js';
import { initializeTogglePreferences, readEffectiveGlobals } from '../../src/state/toggle-preferences.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

const previous = (globalThis as any).spindle;
afterEach(() => { (globalThis as any).spindle = previous; });

function fixture() {
  const disk = new Map<string, unknown>();
  const chats = new Map<string, any>([
    ['a', { metadata: { chat_variables: { local: 'private' }, macro_variables: { global: { toggle_check: '1', toggle_text: 'saved', ordinary: 'a' } } } }],
    ['b', { metadata: { macro_variables: { global: { ordinary: 'b' } } } }],
    ['old', { metadata: { macro_variables: { global: { toggle_check: '1', toggle_text: 'old' } } } }],
  ]);
  (globalThis as any).spindle = {
    userStorage: {
      getJson: async (path: string, opts: any) => structuredClone(disk.get(opts.userId + path) ?? opts.fallback),
      setJson: async (path: string, value: unknown, opts: any) => { disk.set(opts.userId + path, structuredClone(value)); },
    },
    chats: { get: async (id: string) => chats.get(id), update: async () => { throw new Error('Toggle writes must not mutate chat metadata'); } },
  };
  let visible = 'a';
  const sent: BackendToFrontend[] = [];
  const invalidated: string[] = [];
  const active = { card: { character_id: 'character', risuPayload: { scriptstate_defaults: {} } }, lumirealm: { user_overrides: {} } } as ActiveCard;
  const service = () => createVariablesTogglesService({
    translateLang: 'en', variableState: new VariableStateStore(), toggleState: new ToggleStateStore(),
    visibleChatForUser: () => visible,
    invalidateUserToggleReaders: (userId) => { invalidated.push(userId); },
    readLumirealm: async () => null, readAttachedModuleEnvelopes: async () => [],
    ensureActiveCardForChat: async () => active, refreshBgHtml: async () => {},
    send: (msg) => { sent.push(msg); }, log: { info() {}, warn() {}, debug() {} }, errMsg: String,
  });
  const snapshot = async (svc: ReturnType<typeof service>, chat: string, user = 'user') => {
    visible = chat;
    await svc.refreshVariables(active, chat, user, { force: true });
    const msg = sent.filter((m) => m.type === 'set_variables').at(-1)!;
    return msg.scopes;
  };
  return { service, snapshot, invalidated, active, sent };
}

test('toggles survive chat and character changes, service restart, and remain user isolated', async () => {
  const f = fixture(); const svc = f.service();
  await f.snapshot(svc, 'a');
  expect((await f.snapshot(svc, 'b')).global).toEqual({ ordinary: 'b', toggle_check: '1', toggle_text: 'saved' });
  expect((await f.snapshot(svc, 'b')).local).toEqual({});
  expect((await f.snapshot(f.service(), 'b')).global.toggle_text).toBe('saved');
  expect((await f.snapshot(svc, 'b', 'other')).global).toEqual({ ordinary: 'b' });
});

test('zero, empty, deletion and concurrent distinct-key writes persist without legacy resurrection', async () => {
  const f = fixture(); const svc = f.service(); await f.snapshot(svc, 'a');
  const results = await Promise.all([
    svc.writeToggleValue('a', 'check', '0', 'user'),
    svc.writeToggleValue('a', 'text', '', 'user'),
    svc.writeToggleValue('a', 'select', '2', 'user'),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect((await f.snapshot(svc, 'old')).global).toEqual({ toggle_check: '0', toggle_text: '', toggle_select: '2' });
  expect((await svc.writeToggleValue('old', 'text', null, 'user')).ok).toBe(true);
  expect((await f.snapshot(f.service(), 'a')).global).toEqual({ ordinary: 'a', toggle_check: '0', toggle_select: '2' });
  expect(f.invalidated).toEqual(['user', 'user', 'user', 'user']);
});

test('background reads cannot select the migration source or overwrite initialized preferences', async () => {
  const f = fixture(); const svc = f.service();
  await svc.refreshVariables(f.active, 'old', 'user');
  expect(await readEffectiveGlobals('user', {})).toEqual({});
  await f.snapshot(svc, 'a');
  await initializeTogglePreferences('user', { toggle_text: 'old' });
  expect(await readEffectiveGlobals('user', { toggle_text: 'old', ordinary: 'kept' })).toEqual({ toggle_check: '1', toggle_text: 'saved', ordinary: 'kept' });
});

test('preference failures reject instead of silently restoring legacy toggles', async () => {
  fixture();
  (globalThis as any).spindle.userStorage.getJson = async () => ({ toggle_check: 1 });
  await expect(readEffectiveGlobals('user', { toggle_check: 'legacy' })).rejects.toThrow(TypeError);
  await expect(readEffectiveGlobals('', {})).rejects.toThrow(TypeError);
  (globalThis as any).spindle.userStorage.getJson = async () => { throw new Error('storage unavailable'); };
  await expect(readEffectiveGlobals('user', {})).rejects.toThrow('storage unavailable');
  (globalThis as any).spindle.userStorage.getJson = async () => ({ toggle_check: '0' });
  expect(await readEffectiveGlobals('user', {})).toEqual({ toggle_check: '0' });
});
