import { describe, expect, test, beforeEach } from 'bun:test';
import { makeVarsApi, type VarsState } from '../../src/interpreter/runtime/vars.js';
import {
  setActiveScriptstateDefaults,
  clearActiveScriptstateDefaults,
} from '../../src/interpreter/defaults-cache.js';

function makeState(overrides: Partial<VarsState> = {}): VarsState {
  return {
    varsCache: overrides.varsCache ?? {},
    ...(overrides.scriptstateDefaults !== undefined
      ? { scriptstateDefaults: overrides.scriptstateDefaults }
      : {}),
    ...(overrides.tempVars !== undefined ? { tempVars: overrides.tempVars } : {}),
    localScopes: overrides.localScopes ?? new Map(),
    dirty: overrides.dirty ?? { value: false },
    characterId: overrides.characterId ?? null,
  };
}

describe('vars.getVar', () => {
  test('hits chat scope (varsCache) by $-prefixed key', () => {
    const state = makeState({ varsCache: { '$foo': 'bar' } });
    const api = makeVarsApi(state);
    expect(api.getVar('foo')).toBe('bar');
  });

  test('returns Risu literal "null" string when key is missing + no defaults', () => {
    const api = makeVarsApi(makeState());
    expect(api.getVar('absent')).toBe('null');
  });

  test('falls through to character defaultVariables when no var set', () => {
    setActiveScriptstateDefaults('chat-vars-1', 'char-vars-1', { jiyoon_current_icon: 'jiyoon_icon1.png' });
    const api = makeVarsApi(makeState({ characterId: 'char-vars-1' }));
    expect(api.getVar('jiyoon_current_icon')).toBe('jiyoon_icon1.png');
    clearActiveScriptstateDefaults('chat-vars-1');
  });

  test('chat-scope value WINS over default fallback', () => {
    setActiveScriptstateDefaults('chat-vars-2', 'char-vars-2', { name: 'default-name' });
    const api = makeVarsApi(makeState({
      characterId: 'char-vars-2',
      varsCache: { '$name': 'override' },
    }));
    expect(api.getVar('name')).toBe('override');
    clearActiveScriptstateDefaults('chat-vars-2');
  });

  test('null characterId → no defaults consulted', () => {
    setActiveScriptstateDefaults('chat-vars-3', 'char-vars-3', { x: 'y' });
    // characterId in state is null, so defaults shouldn't apply even though
    // they were published for some other character.
    const api = makeVarsApi(makeState({ characterId: null }));
    expect(api.getVar('x')).toBe('null');
    clearActiveScriptstateDefaults('chat-vars-3');
  });
});

describe('vars.setVar', () => {
  test('writes to varsCache with $ prefix + flips dirty', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    expect(state.dirty.value).toBe(false);
    api.setVar('foo', 'bar');
    expect(state.varsCache['$foo']).toBe('bar');
    expect(state.dirty.value).toBe(true);
  });

  test('coerces non-string values to string', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    api.setVar('num', 42);
    api.setVar('bool', true);
    api.setVar('obj', { a: 1 });
    expect(state.varsCache['$num']).toBe('42');
    expect(state.varsCache['$bool']).toBe('true');
    expect(state.varsCache['$obj']).toBe('[object Object]');
  });

  test('null/undefined values become empty string', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    api.setVar('a', null);
    api.setVar('b', undefined);
    expect(state.varsCache['$a']).toBe('');
    expect(state.varsCache['$b']).toBe('');
  });

  test('overwrite preserves dirty=true on subsequent writes', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    api.setVar('foo', 'first');
    state.dirty.value = false; // simulate flush() resetting
    api.setVar('foo', 'second');
    expect(state.varsCache['$foo']).toBe('second');
    expect(state.dirty.value).toBe(true);
  });

  test('display writes stay temporary and do not dirty persisted state', () => {
    const tempVars: Record<string, string> = {};
    const state = makeState({
      varsCache: { '$bahasa': '1' },
      tempVars,
    });
    const api = makeVarsApi(state);

    api.setvarV2('bahasa', '=', '6');
    api.setvarV2('scratch', '=', '7');

    expect(state.varsCache).toEqual({ '$bahasa': '1' });
    expect(state.dirty.value).toBe(false);
    expect(tempVars).toEqual({ bahasa: '6', scratch: '7' });
    expect(api.getVar('bahasa')).toBe('1');
    expect(api.getVar('scratch')).toBe('7');
  });
});

describe('vars display precedence', () => {
  test('reads local, persisted, defaults, then temporary values', () => {
    const tempVars = {
      local: 'temp-local',
      persisted: 'temp-persisted',
      defaulted: 'temp-default',
      temporary: 'temp-only',
    };
    const state = makeState({
      varsCache: { '$persisted': 'persisted-value' },
      scriptstateDefaults: { defaulted: 'default-value' },
      tempVars,
    });
    const api = makeVarsApi(state);
    api.declareLocalVar('local', 'local-value', 0);

    expect(api.getVar('local')).toBe('local-value');
    expect(api.getVar('persisted')).toBe('persisted-value');
    expect(api.getVar('defaulted')).toBe('default-value');
    expect(api.getVar('temporary')).toBe('temp-only');
  });
});

describe('vars.resolve', () => {
  const api = makeVarsApi(makeState({ varsCache: { '$x': 'value-x' } }));

  test("kind='value' → returns input as-is via toStr", () => {
    expect(api.resolve('hello', 'value')).toBe('hello');
    expect(api.resolve(42, 'value')).toBe('42');
  });

  test("kind='regex' → returns input as-is", () => {
    expect(api.resolve('pattern', 'regex')).toBe('pattern');
  });

  test("kind='var' → looks up in varsCache", () => {
    expect(api.resolve('x', 'var')).toBe('value-x');
    expect(api.resolve('missing', 'var')).toBe('null');
  });

  test('unknown kind defaults to value semantic', () => {
    expect(api.resolve('hello', 'whatever')).toBe('hello');
  });
});

describe('vars.declareLocalVar + getLocal precedence', () => {
  test('declared local shadows chat-scope', () => {
    const state = makeState({ varsCache: { '$x': 'chat-value' } });
    const api = makeVarsApi(state);
    api.declareLocalVar('x', 'local-value', 1);
    expect(api.getVar('x')).toBe('local-value');
  });

  test('deeper local indent wins (reverse iteration)', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    api.declareLocalVar('x', 'shallow', 1);
    api.declareLocalVar('x', 'deep', 3);
    expect(api.getLocal('x')).toBe('deep');
    expect(api.getVar('x')).toBe('deep');
  });

  test('local miss falls through to chat scope', () => {
    const state = makeState({ varsCache: { '$y': 'chat-y' } });
    const api = makeVarsApi(state);
    api.declareLocalVar('x', 'local-x', 1);
    expect(api.getVar('y')).toBe('chat-y');
  });

  test('non-numeric indent → 0', () => {
    const state = makeState();
    const api = makeVarsApi(state);
    api.declareLocalVar('x', 'v', 'not-a-number');
    expect(state.localScopes.has(0)).toBe(true);
    expect(api.getLocal('x')).toBe('v');
  });
});

describe('vars.setvarV1', () => {
  let state: VarsState;
  let api: ReturnType<typeof makeVarsApi>;
  beforeEach(() => {
    state = makeState();
    api = makeVarsApi(state);
  });

  test("'=' or empty op assigns", () => {
    api.setvarV1('x', '=', '5');
    expect(api.getVar('x')).toBe('5');
    api.setvarV1('y', '', '10');
    expect(api.getVar('y')).toBe('10');
  });

  test('+= adds numerically', () => {
    api.setVar('counter', '7');
    api.setvarV1('counter', '+=', '3');
    expect(api.getVar('counter')).toBe('10');
  });

  test('-= subtracts numerically', () => {
    api.setVar('h', '20');
    api.setvarV1('h', '-=', '5');
    expect(api.getVar('h')).toBe('15');
  });

  test('*= multiplies', () => {
    api.setVar('m', '6');
    api.setvarV1('m', '*=', '7');
    expect(api.getVar('m')).toBe('42');
  });

  test('/= zero divisor → 0 (Risu parity)', () => {
    api.setVar('q', '10');
    api.setvarV1('q', '/=', '0');
    expect(api.getVar('q')).toBe('0');
  });

  test('non-numeric prev → treated as 0 base', () => {
    api.setVar('x', 'abc');
    api.setvarV1('x', '+=', '5');
    expect(api.getVar('x')).toBe('5');
  });

  test('unknown op → assign rendered value', () => {
    api.setVar('x', 'old');
    api.setvarV1('x', 'wat', 'new');
    expect(api.getVar('x')).toBe('new');
  });
});

describe('vars.setvarV2', () => {
  let state: VarsState;
  let api: ReturnType<typeof makeVarsApi>;
  beforeEach(() => {
    state = makeState();
    api = makeVarsApi(state);
  });

  test('= assigns', () => {
    api.setvarV2('x', '=', '42');
    expect(api.getVar('x')).toBe('42');
  });

  test('+= numeric add', () => {
    api.setVar('n', '5');
    api.setvarV2('n', '+=', '7');
    expect(api.getVar('n')).toBe('12');
  });

  test('+= non-numeric → string concat', () => {
    api.setVar('s', 'hello ');
    api.setvarV2('s', '+=', 'world');
    expect(api.getVar('s')).toBe('hello world');
  });

  test('+= one-side numeric → still string concat (both must be numeric)', () => {
    api.setVar('s', '5');
    api.setvarV2('s', '+=', 'abc');
    expect(api.getVar('s')).toBe('5abc');
  });

  test('%= zero divisor → 0', () => {
    api.setVar('m', '10');
    api.setvarV2('m', '%=', '0');
    expect(api.getVar('m')).toBe('0');
  });

  test('%= non-zero', () => {
    api.setVar('m', '10');
    api.setvarV2('m', '%=', '3');
    expect(api.getVar('m')).toBe('1');
  });
});

describe('shared state semantics', () => {
  test('two VarsApi instances over the SAME state share writes', () => {
    const state = makeState();
    const a = makeVarsApi(state);
    const b = makeVarsApi(state);
    a.setVar('shared', 'value-from-a');
    expect(b.getVar('shared')).toBe('value-from-a');
    b.setVar('shared', 'value-from-b');
    expect(a.getVar('shared')).toBe('value-from-b');
  });

  test('boxed dirty flag is observable to outside reader (flush() pattern)', () => {
    const dirty = { value: false };
    const state = makeState({ dirty });
    const api = makeVarsApi(state);
    expect(dirty.value).toBe(false);
    api.setVar('x', 'y');
    expect(dirty.value).toBe(true); // outside-the-closure reader sees the flip
  });
});
