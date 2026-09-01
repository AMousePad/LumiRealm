import { describe, expect, test } from 'bun:test';
import { makeDisplayStateApi } from '../../src/interpreter/runtime/display-state.js';

describe('display-state.displayState', () => {
  test('initial value is empty string', () => {
    const api = makeDisplayStateApi();
    expect(api.getDisplayState()).toBe('');
  });

  test('set + get round-trip', () => {
    const api = makeDisplayStateApi();
    api.setDisplayState('hello');
    expect(api.getDisplayState()).toBe('hello');
  });

  test('non-string values coerced via toStr', () => {
    const api = makeDisplayStateApi();
    api.setDisplayState(42);
    expect(api.getDisplayState()).toBe('42');
    api.setDisplayState(null);
    expect(api.getDisplayState()).toBe('');
  });

  test('two distinct factories have separate state', () => {
    const a = makeDisplayStateApi();
    const b = makeDisplayStateApi();
    a.setDisplayState('A');
    b.setDisplayState('B');
    expect(a.getDisplayState()).toBe('A');
    expect(b.getDisplayState()).toBe('B');
  });
});

describe('display-state.requestState', () => {
  test('initial length is 0', () => {
    const api = makeDisplayStateApi();
    expect(api.getRequestStateLength()).toBe(0);
  });

  test('setRequestState on an out-of-range index throws (Risu json[index].content on undefined)', () => {
    const api = makeDisplayStateApi();
    expect(() => api.setRequestState(2, 'msg-at-2')).toThrow(RangeError);
    expect(api.getRequestStateLength()).toBe(0);
  });

  test('setRequestStateRole + setRequestState preserve each other', () => {
    const api = makeDisplayStateApi('', [{ role: 'user', content: '' }]);
    api.setRequestStateRole(0, 'system');
    api.setRequestState(0, 'system-content');
    expect(api.getRequestStateRole(0)).toBe('system');
    expect(api.getRequestState(0)).toBe('system-content');
  });

  test('setRequestStateRole ignores values outside the Risu role whitelist', () => {
    const api = makeDisplayStateApi('', [{ role: 'user', content: 'x' }]);
    api.setRequestStateRole(0, 'narrator');
    expect(api.getRequestStateRole(0)).toBe('user');
  });

  test('out-of-range read returns the string null (Risu ?? fallback)', () => {
    const api = makeDisplayStateApi();
    expect(api.getRequestState(99)).toBe('null');
    expect(api.getRequestStateRole(99)).toBe('null');
  });

  test('non-numeric index throws on set (Risu json[NaN].content on undefined)', () => {
    const api = makeDisplayStateApi();
    expect(() => api.setRequestState('not-a-number', 'val')).toThrow(RangeError);
    expect(api.getRequestStateLength()).toBe(0);
  });

  test('overwrite updates content without changing length', () => {
    const api = makeDisplayStateApi('', [{ role: 'user', content: 'a' }]);
    api.setRequestState(0, 'b');
    expect(api.getRequestStateLength()).toBe(1);
    expect(api.getRequestState(0)).toBe('b');
  });
});
