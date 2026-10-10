import { expect, test } from 'bun:test';
import { makeVarsApi } from '../../../src/interpreter/runtime/vars.js';
import { loadVars, loadGlobalVars, saveVars } from '../../../src/interpreter/runtime/chat-state.js';
import { invalidateRecentFlush } from '../../../src/state/recent-flush-cache.js';
import { buildEvaluatorContext } from '../../../src/interpreter/evaluator/context.js';
import { runTriggerEffects } from '../../helpers/trigger-runtime.js';
import type { HostApi } from '../../../src/interpreter/host.js';

for (const execution of ['interpreted', 'compiled'] as const) {
  for (const preloaded of [false, true]) {
    test(`${execution} uses defaults for saved null through ${preloaded ? 'preload' : 'storage'}`, async () => {
      const initial = { defaulted: null, missing: null, empty: '', literal: 'null' };
      const defaults = { defaulted: '7', empty: '8', literal: '9' };
      const { saved } = await runTriggerEffects([
        ...Object.keys(initial).map(varName => ({
          type: 'v2SetVar' as const, var: 'read_' + varName, value: varName,
          valueType: 'var' as const, operator: '=' as const, indent: 0,
        })),
        { type: 'v2SetVar', var: 'macro', value: '{{getvar::defaulted}}', valueType: 'value', operator: '=', indent: 0 },
      ], initial, { preloaded: {
        scriptstateDefaults: defaults,
        ...(preloaded ? { varsCache: Object.fromEntries(Object.entries(initial).map(([k, v]) => ['$' + k, v])) } : {}),
      } }, [], execution);
      expect(saved).toEqual({ ...initial, read_defaulted: '7', read_missing: 'null', read_empty: '', read_literal: 'null', macro: '7' });
    });
  }
}

test('null falls through to display temporary state only after defaults', () => {
  const vars = makeVarsApi({
    varsCache: { $defaulted: null, $temporary: null }, scriptstateDefaults: { defaulted: 'default' },
    tempVars: { defaulted: 'temporary', temporary: 'temporary' },
    localScopes: new Map(), dirty: { value: false }, characterId: null,
  });
  expect(vars.getVar('defaulted')).toBe('default');
  expect(vars.getVar('temporary')).toBe('temporary');
  expect(vars.getStoredVar('temporary')).toBe('null');
});

test('saved null survives an unrelated flush and the recent-flush cache', async () => {
  const metadata: Record<string, unknown> = { chat_variables: { absent: null, empty: '' } };
  const api = { chat: {
    getMetadata: async (key: string) => metadata[key],
    setMetadata: async (key: string, value: unknown) => { metadata[key] = value; },
  } } as unknown as HostApi;
  const chatId = 'null-variable-cache';
  try {
    const vars = await loadVars(api, chatId);
    expect(vars).toEqual({ $absent: null, $empty: '' });
    vars.$changed = '1';
    await saveVars(api, vars, chatId);
    expect(metadata.chat_variables).toEqual({ absent: null, empty: '', changed: '1' });
    expect(await loadVars(api, chatId)).toEqual(vars);
  } finally { invalidateRecentFlush(chatId); }
});

test('global null remains distinct from empty text and reads as missing', async () => {
  const api = { chat: { getMetadata: async () => ({ global: { absent: null, empty: '', literal: 'null' } }) } } as unknown as HostApi;
  const globalVars = await loadGlobalVars(api);
  expect(globalVars).toEqual({ absent: null, empty: '', literal: 'null' });
  const { runtime } = await runTriggerEffects([], {}, { preloaded: { globalVars } });
  await runtime.runLua('setChatVar("test", "read", getGlobalVar("test", "absent"))');
  expect(runtime.getVar('read')).toBe('null');
});

test('CBS reads null as missing without losing explicit empty or literal null values', () => {
  const ctx = buildEvaluatorContext({
    chatId: 'null-cbs', userName: '', charName: '', character: {}, chat: {}, commit: false,
    variables: { local: { defaulted: null, missing: null, empty: '', literal: 'null' }, chat: { defaulted: null } },
    scriptstateDefaults: { defaulted: '7', empty: '8', literal: '9' },
  });
  expect(['defaulted', 'missing', 'empty', 'literal'].map(key => ctx.vars.get('local', key)))
    .toEqual(['7', 'null', '', 'null']);
});
