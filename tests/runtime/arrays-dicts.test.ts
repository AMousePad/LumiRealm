import { describe, expect, test, beforeEach } from 'bun:test';
import { makeVarsApi, type VarsApi } from '../../src/interpreter/runtime/vars.js';
import { makeArraysDictsApi, type ArraysDictsApi } from '../../src/interpreter/runtime/arrays-dicts.js';

function newApi() {
  const vars = makeVarsApi({
    varsCache: {},
    localScopes: new Map(),
    dirty: { value: false },
    characterId: null,
  });
  return { api: makeArraysDictsApi(vars), vars };
}

describe('arrays-dicts.array operations', () => {
  let api: ArraysDictsApi;
  let vars: VarsApi;
  beforeEach(() => { ({ api, vars } = newApi()); });

  test('makeArrayVar initialises to []', () => {
    api.makeArrayVar('x');
    expect(api.arrayLength('x')).toBe('0');
  });

  test('arrayPush + arrayLength + arrayGet', () => {
    api.makeArrayVar('list');
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    api.arrayPush('list', 'c');
    expect(api.arrayLength('list')).toBe('3');
    expect(api.arrayGet('list', 0)).toBe('a');
    expect(api.arrayGet('list', 2)).toBe('c');
  });

  test('arrayGet out-of-range returns null', () => {
    api.makeArrayVar('list');
    api.arrayPush('list', 'a');
    expect(api.arrayGet('list', 99)).toBe('null');
  });

  test('arraySet writes index', () => {
    api.makeArrayVar('list');
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    api.arraySet('list', 0, 'X');
    expect(api.arrayGet('list', 0)).toBe('X');
  });

  test('arrayPop removes + returns last', () => {
    api.makeArrayVar('list');
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    expect(api.arrayPop('list')).toBe('b');
    expect(api.arrayLength('list')).toBe('1');
  });

  test('arrayPop empty returns null', () => {
    api.makeArrayVar('list');
    expect(api.arrayPop('list')).toBe('null');
  });

  test('arrayShift / arrayUnshift', () => {
    api.makeArrayVar('q');
    api.arrayPush('q', 'a');
    api.arrayPush('q', 'b');
    expect(api.arrayShift('q')).toBe('a');
    api.arrayUnshift('q', 'X');
    expect(api.arrayGet('q', 0)).toBe('X');
  });

  test('arraySplice inserts at index', () => {
    api.makeArrayVar('s');
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'c');
    api.arraySplice('s', 1, 'b');
    expect(api.arrayJoin(vars.getVar('s'), ',')).toBe('a,b,c');
  });

  test('arraySlice returns JSON', () => {
    api.makeArrayVar('s');
    api.arrayPush('s', '0');
    api.arrayPush('s', '1');
    api.arrayPush('s', '2');
    api.arrayPush('s', '3');
    expect(api.arraySlice('s', 1, 3)).toBe('["1","2"]');
  });

  test('arrayJoin custom delimiter', () => {
    api.makeArrayVar('s');
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    expect(api.arrayJoin(vars.getVar('s'), '|')).toBe('a|b');
  });

  test('arrayIndexOf returns first index or -1', () => {
    api.makeArrayVar('s');
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    api.arrayPush('s', 'c');
    expect(api.arrayIndexOf('s', 'b')).toBe(1);
    expect(api.arrayIndexOf('s', 'missing')).toBe(-1);
  });

  test('arrayRemoveIndex deletes one', () => {
    api.makeArrayVar('s');
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    api.arrayPush('s', 'c');
    api.arrayRemoveIndex('s', 1);
    expect(api.arrayJoin(vars.getVar('s'), ',')).toBe('a,c');
  });

  test('uninitialised array reads as empty', () => {
    expect(api.arrayLength('never-touched')).toBe('0');
    expect(api.arrayGet('never-touched', 0)).toBe('null');
  });
});

describe('arrays-dicts.dict operations', () => {
  let api: ArraysDictsApi;
  let vars: VarsApi;
  beforeEach(() => { ({ api, vars } = newApi()); });

  test('makeDictVar initialises empty', () => {
    api.makeDictVar('d');
    expect(api.dictSize(vars.getVar('d'))).toBe(0);
  });

  test('dictSet + dictGet', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictGet(vars.getVar('d'), 'k')).toBe('v');
  });

  test('dictGet missing returns null', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictGet(vars.getVar('d'), 'missing')).toBe('null');
  });

  test('dictDelete removes', () => {
    api.dictSet('d', 'k', 'v');
    api.dictDelete('d', 'k');
    expect(api.dictHasKey(vars.getVar('d'), 'k')).toBe(false);
  });

  test('dictHasKey true/false', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictHasKey(vars.getVar('d'), 'k')).toBe(true);
    expect(api.dictHasKey(vars.getVar('d'), 'other')).toBe(false);
  });

  test('dictClear empties', () => {
    api.dictSet('d', 'a', '1');
    api.dictSet('d', 'b', '2');
    api.dictClear('d');
    expect(api.dictSize(vars.getVar('d'))).toBe(0);
  });

  test('dictKeys / dictValues', () => {
    api.dictSet('d', 'a', '1');
    api.dictSet('d', 'b', '2');
    expect(api.dictKeys(vars.getVar('d')).sort()).toEqual(['a', 'b']);
    expect(api.dictValues(vars.getVar('d')).sort()).toEqual(['1', '2']);
  });

  test('uninitialised dict reads as empty', () => {
    expect(api.dictSize(vars.getVar('never-touched'))).toBe(0);
    expect(api.dictGet(vars.getVar('never-touched'), 'k')).toBe('null');
    expect(api.dictHasKey(vars.getVar('never-touched'), 'k')).toBe(false);
  });
});

describe('arrays-dicts.persistence shape', () => {
  test('arrays stored under their ordinary variable name', () => {
    const vars = makeVarsApi({
      varsCache: {},
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    api.makeArrayVar('foo');
    api.arrayPush('foo', 'x');
    expect(vars.getVar('foo')).toBe('["x"]');
  });

  test('dictionaries stored under their ordinary variable name', () => {
    const vars = makeVarsApi({
      varsCache: {},
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    api.dictSet('foo', 'k', 'v');
    expect(vars.getVar('foo')).toBe('{"k":"v"}');
  });

  test('corrupted JSON in storage → reads as empty array/dict', () => {
    const vars = makeVarsApi({
      varsCache: { '$bad': 'not-json' },
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    expect(api.arrayLength('bad')).toBe('0');
  });
});
