import { expect, test } from 'bun:test';
import { createNativeVariableMacros } from '../../src/display/native-variable-macros.js';

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
