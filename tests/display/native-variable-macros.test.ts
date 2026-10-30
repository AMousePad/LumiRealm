import { expect, test } from 'bun:test';
import { createNativeVariableMacros } from '../../src/display/native-variable-macros.js';

test('captured prompt inputs support native aliases, defaults and multiselect queries', () => {
  const resolve = createNativeVariableMacros({ local: {}, global: {}, chat: {} }, new Set(), {
    local: { mode: 'live' }, global: { mode: 'global' }, chat: { mode: 'chat' },
    prompt_defaults: { mode: 'default', fallback: 4 }, prompt_selections: { choices: ['a', 'b'] },
  });
  expect(resolve('presetVar', ['mode'])?.text).toBe('live');
  expect(resolve('.mode', [])?.text).toBe('live');
  expect(resolve('getgvar', ['mode'])?.text).toBe('global');
  expect(resolve('getchatvar', ['mode'])?.text).toBe('chat');
  expect(resolve('promptVarDefault', ['mode'])?.text).toBe('default');
  expect(resolve('var', ['fallback'])?.text).toBe('4');
  expect(resolve('hasPresetVar', ['fallback'])?.text).toBe('true');
  expect(resolve('var', ['choices', 'ison', 'a,b'])?.text).toBe('true');
  expect(resolve('var', ['choices', 'ison', 'a,c'])?.text).toBe('false');
  expect(resolve('var', ['unknown', 'ison', ''])?.text).toBe('true');
  expect(resolve('var', ['__proto__'])?.text).toBe('');
});

test('captured variable lookups and writes do not scan unrelated preset inputs', () => {
  let scans = 0;
  const tracked = <T extends object>(values: T): T => new Proxy(values, {
    ownKeys(target) { scans++; return Reflect.ownKeys(target); },
  });
  const local = tracked(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, String(i)])));
  const resolve = createNativeVariableMacros({ local: {}, global: {}, chat: {} }, new Set(), {
    local, global: tracked({ name: 'global' }), chat: tracked({ name: 'chat' }),
    prompt_defaults: tracked({ fallback: 4 }), prompt_selections: tracked({ choices: ['a'] }),
  });
  expect(resolve('var', ['key1'])?.text).toBe('1');
  expect(resolve('getgvar', ['name'])?.text).toBe('global');
  expect(resolve('getchatvar', ['name'])?.text).toBe('chat');
  expect(resolve('var', ['fallback'])?.text).toBe('4');
  expect(resolve('var', ['choices', 'ison', 'a'])?.text).toBe('true');
  expect(resolve('incvar', ['key1'])?.text).toBe('2');
  expect(resolve('deletevar', ['key1'])?.text).toBe('');
  expect(resolve('getvar', ['key1'])?.text).toBe('');
  expect(local.key1).toBe('1');
  expect(scans).toBe(0);
});

test('captured variable overrides and deletions remain private to each invocation', () => {
  const local = Object.freeze(JSON.parse('{"mode":"saved","n":"2.5units","__proto__":"own"}') as Record<string, string>);
  const preset = {
    local, global: Object.freeze({ name: 'global' }), chat: Object.freeze({ name: 'chat' }),
    prompt_defaults: Object.freeze({ mode: 'default', fallback: 0 }),
    prompt_selections: { choices: ['a', 'b'] },
  };
  const vars = { local: {}, global: {}, chat: {} };
  const touched = new Set<string>();
  const first = createNativeVariableMacros(vars, touched, preset);
  const second = createNativeVariableMacros(vars, new Set(), preset);
  expect(first('getvar', ['__proto__'])?.text).toBe('own');
  first('deletevar', ['__proto__']);
  expect(first('hasvar', ['__proto__'])?.text).toBe('false');
  first('setvar', ['__proto__', 'changed']);
  expect(first('getvar', ['__proto__'])?.text).toBe('changed');
  first('deletevar', ['mode']);
  expect(first('getvar', ['mode'])?.text).toBe('');
  expect(first('var', ['mode'])?.text).toBe('default');
  expect(first('varDefault', ['fallback'])?.text).toBe('0');
  expect(first('addvar', ['n', '3.25more'])?.text).toBe('5.75');
  first('setgvar', ['name', 'changed']);
  first('flushchatvar', ['name']);
  expect(first('getgvar', ['name'])?.text).toBe('changed');
  expect(first('haschatvar', ['name'])?.text).toBe('false');
  expect(second('getvar', ['mode'])?.text).toBe('saved');
  expect(second('getvar', ['__proto__'])?.text).toBe('own');
  expect(second('getgvar', ['name'])?.text).toBe('global');
  expect(second('getchatvar', ['name'])?.text).toBe('chat');
  expect([...touched].sort()).toEqual(['chat:name', 'global:name', 'local:name']);
  expect(first('var', ['constructor'])?.text).toBe('');
  expect(first('varDefault', ['constructor'])?.text).toBe('');
  expect(first('var', ['constructor', 'ison', 'a'])?.text).toBe('false');
});

test('native null entries still exist and stringify like the host', () => {
  const resolve = createNativeVariableMacros({ local: { missing: null, empty: '', literal: 'null' }, global: { missing: null }, chat: {} }, new Set());
  expect(resolve('getchatvar', ['missing'])?.text).toBe('null');
  expect(resolve('getgvar', ['missing'])?.text).toBe('null');
  expect(resolve('haschatvar', ['missing'])?.text).toBe('true');
  expect(resolve('hasgvar', ['missing'])?.text).toBe('true');
  expect(resolve('getchatvar', ['empty'])?.text).toBe('');
  expect(resolve('getchatvar', ['literal'])?.text).toBe('null');
  expect(resolve('getchatvar', ['absent'])?.text).toBe('');
  expect(resolve('haschatvar', ['absent'])?.text).toBe('false');
});

test('native variables keep local, global, and persisted chat namespaces separate', () => {
  const touched = new Set<string>();
  const resolve = createNativeVariableMacros({ local: { route: 'CHAT' }, global: { route: 'GLOBAL' }, chat: {} }, touched);
  expect(resolve('getvar', ['route'])?.text).toBe('');
  expect(resolve('getchatvar', [' route '])?.text).toBe('CHAT');
  expect(resolve('getgvar', ['route'])?.text).toBe('GLOBAL');
  expect(resolve('getglobalvar', ['missing'])?.text).toBe('');
  expect([...touched].sort()).toEqual(['chat:route', 'global:missing', 'global:route', 'local:route']);
});

test('native writes are visible to later reads but never mutate the snapshot', () => {
  const vars = { local: { route: 'CHAT' }, global: {}, chat: {} };
  const resolve = createNativeVariableMacros(vars, new Set());
  expect(resolve('setvar', ['route', 'LOCAL'])?.text).toBe('');
  expect(resolve('getvar', ['route'])?.text).toBe('LOCAL');
  expect(resolve('setchatvar', ['route', 'NEW'])?.text).toBe('');
  expect(resolve('getchatvar', ['route'])?.text).toBe('NEW');
  expect(resolve('haschatvar', ['route'])?.text).toBe('true');
  expect(resolve('flushchatvar', ['route'])?.text).toBe('');
  expect(resolve('haschatvar', ['route'])?.text).toBe('false');
  expect(vars.local.route).toBe('CHAT');
  expect(createNativeVariableMacros(vars, new Set())('getvar', ['route'])?.text).toBe('');
});

test('native numeric writes preserve host coercion and return values', () => {
  const resolve = createNativeVariableMacros({ local: {}, global: {}, chat: {} }, new Set());
  resolve('setvar', ['n', '2.5units']);
  expect(resolve('addvar', ['n', '3.25more'])?.text).toBe('5.75');
  expect(resolve('incvar', ['n'])?.text).toBe('6');
  expect(resolve('decvar', ['n'])?.text).toBe('5');
  expect(resolve('addglobalvar', ['n', 'invalid'])?.text).toBe('0');
  expect(resolve('incchatvar', ['n'])?.text).toBe('1');
  expect(resolve('hasglobalvar', ['n'])?.text).toBe('true');
  expect(resolve('deleteglobalvar', ['n'])?.text).toBe('');
  expect(resolve('gvarexists', ['n'])?.text).toBe('false');
});

test('native variable keys are literal and prototype-safe', () => {
  const resolve = createNativeVariableMacros({ local: {}, global: {}, chat: {} }, new Set());
  expect(resolve('getvar', ['__proto__'])?.text).toBe('');
  resolve('setvar', ['__proto__', 'value']);
  expect(resolve('getvar', ['__proto__'])?.text).toBe('value');
  expect(resolve('getvar', ['setvar::x::bad'])?.text).toBe('');
  expect(resolve('hasvar', ['x'])?.text).toBe('false');
  expect(resolve('unrelated', [])).toBeUndefined();
});
