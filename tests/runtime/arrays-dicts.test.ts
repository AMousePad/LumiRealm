import { describe, expect, test, beforeEach } from 'bun:test';
import { makeVarsApi } from '../../src/interpreter/runtime/vars.js';
import { makeArraysDictsApi, type ArraysDictsApi } from '../../src/interpreter/runtime/arrays-dicts.js';

function newApi(): ArraysDictsApi {
  const vars = makeVarsApi({
    varsCache: {},
    localScopes: new Map(),
    dirty: { value: false },
    characterId: null,
  });
  return makeArraysDictsApi(vars);
}

describe('arrays-dicts.array operations', () => {
  let api: ArraysDictsApi;
  beforeEach(() => { api = newApi(); });

  test('makeArrayVar initialises to []', () => {
    api.makeArrayVar('x');
    expect(api.arrayLength('x')).toBe(0);
  });

  test('arrayPush + arrayLength + arrayGet', () => {
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    api.arrayPush('list', 'c');
    expect(api.arrayLength('list')).toBe(3);
    expect(api.arrayGet('list', 0)).toBe('a');
    expect(api.arrayGet('list', 2)).toBe('c');
  });

  test('arrayGet out-of-range → empty string', () => {
    api.arrayPush('list', 'a');
    expect(api.arrayGet('list', 99)).toBe('');
  });

  test('arraySet writes index', () => {
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    api.arraySet('list', 0, 'X');
    expect(api.arrayGet('list', 0)).toBe('X');
  });

  test('arrayPop removes + returns last', () => {
    api.arrayPush('list', 'a');
    api.arrayPush('list', 'b');
    expect(api.arrayPop('list')).toBe('b');
    expect(api.arrayLength('list')).toBe(1);
  });

  test('arrayPop empty → empty string', () => {
    api.makeArrayVar('list');
    expect(api.arrayPop('list')).toBe('');
  });

  test('arrayShift / arrayUnshift', () => {
    api.arrayPush('q', 'a');
    api.arrayPush('q', 'b');
    expect(api.arrayShift('q')).toBe('a');
    api.arrayUnshift('q', 'X');
    expect(api.arrayGet('q', 0)).toBe('X');
  });

  test('arraySplice inserts at index', () => {
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'c');
    api.arraySplice('s', 1, 'b');
    expect(api.arrayJoin('s', ',')).toBe('a,b,c');
  });

  test('arraySlice returns comma-joined slice', () => {
    api.arrayPush('s', '0');
    api.arrayPush('s', '1');
    api.arrayPush('s', '2');
    api.arrayPush('s', '3');
    expect(api.arraySlice('s', 1, 3)).toBe('1,2');
  });

  test('arrayJoin custom delimiter', () => {
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    expect(api.arrayJoin('s', '|')).toBe('a|b');
  });

  test('arrayIndexOf returns first index or -1', () => {
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    api.arrayPush('s', 'c');
    expect(api.arrayIndexOf('s', 'b')).toBe(1);
    expect(api.arrayIndexOf('s', 'missing')).toBe(-1);
  });

  test('arrayRemoveIndex deletes one', () => {
    api.arrayPush('s', 'a');
    api.arrayPush('s', 'b');
    api.arrayPush('s', 'c');
    api.arrayRemoveIndex('s', 1);
    expect(api.arrayJoin('s', ',')).toBe('a,c');
  });

  test('uninitialised array reads as empty', () => {
    expect(api.arrayLength('never-touched')).toBe(0);
    expect(api.arrayGet('never-touched', 0)).toBe('');
  });
});

describe('arrays-dicts.dict operations', () => {
  let api: ArraysDictsApi;
  beforeEach(() => { api = newApi(); });

  test('makeDictVar initialises empty', () => {
    api.makeDictVar('d');
    expect(api.dictSize('d')).toBe(0);
  });

  test('dictSet + dictGet', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictGet('d', 'k')).toBe('v');
  });

  test('dictGet missing → empty string', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictGet('d', 'missing')).toBe('');
  });

  test('dictDelete removes', () => {
    api.dictSet('d', 'k', 'v');
    api.dictDelete('d', 'k');
    expect(api.dictHasKey('d', 'k')).toBe(false);
  });

  test('dictHasKey true/false', () => {
    api.dictSet('d', 'k', 'v');
    expect(api.dictHasKey('d', 'k')).toBe(true);
    expect(api.dictHasKey('d', 'other')).toBe(false);
  });

  test('dictClear empties', () => {
    api.dictSet('d', 'a', '1');
    api.dictSet('d', 'b', '2');
    api.dictClear('d');
    expect(api.dictSize('d')).toBe(0);
  });

  test('dictKeys / dictValues', () => {
    api.dictSet('d', 'a', '1');
    api.dictSet('d', 'b', '2');
    expect(api.dictKeys('d').sort()).toEqual(['a', 'b']);
    expect(api.dictValues('d').sort()).toEqual(['1', '2']);
  });

  test('uninitialised dict reads as empty', () => {
    expect(api.dictSize('never-touched')).toBe(0);
    expect(api.dictGet('never-touched', 'k')).toBe('');
    expect(api.dictHasKey('never-touched', 'k')).toBe(false);
  });
});

describe('arrays-dicts.persistence shape', () => {
  test('arrays stored under __risuArr__ prefix in vars', () => {
    const vars = makeVarsApi({
      varsCache: {},
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    api.arrayPush('foo', 'x');
    expect(vars.getVar('__risuArr__foo')).toBe('["x"]');
  });

  test('dicts stored under __risuDict__ prefix in vars', () => {
    const vars = makeVarsApi({
      varsCache: {},
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    api.dictSet('foo', 'k', 'v');
    expect(vars.getVar('__risuDict__foo')).toBe('{"k":"v"}');
  });

  test('corrupted JSON in storage → reads as empty array/dict', () => {
    const vars = makeVarsApi({
      varsCache: { '$__risuArr__bad': 'not-json' },
      localScopes: new Map(),
      dirty: { value: false },
      characterId: null,
    });
    const api = makeArraysDictsApi(vars);
    expect(api.arrayLength('bad')).toBe(0);
  });
});
