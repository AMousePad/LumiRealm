import { describe, test, expect, mock } from 'bun:test';

type FakeEngine = {
  global: {
    set: (n: string, v: unknown) => void;
    get: (n: string) => unknown;
    close: () => void;
  };
  doString: (s: string) => Promise<unknown>;
  store: Map<string, unknown>;
  doStringCalls: string[];
  closeCount: () => number;
};

const createdEngines: FakeEngine[] = [];

function makeFakeEngine(): FakeEngine {
  const store = new Map<string, unknown>();
  let closes = 0;
  const engine: FakeEngine = {
    store,
    doStringCalls: [],
    global: {
      set: (n, v) => {
        store.set(n, v);
      },
      get: (n) => store.get(n),
      close: () => {
        closes++;
      },
    },
    async doString(s) {
      engine.doStringCalls.push(s);
      store.set('callListenMain', (...args: unknown[]) => args[0]);
      return undefined;
    },
    closeCount: () => closes,
  };
  return engine;
}

class FakeLuaFactory {
  async mountFile(): Promise<void> {}
  async createEngine(): Promise<FakeEngine> {
    const engine = makeFakeEngine();
    createdEngines.push(engine);
    return engine;
  }
}

mock.module('wasmoon', () => ({ LuaFactory: FakeLuaFactory }));
mock.module('../display/_glue-wasm-b64.js', () => ({ GLUE_WASM_DATA_URI: 'data:application/wasm;base64,' }));

const { executeWasmoon, clearWasmoonEngine } = await import('./lua-wasmoon.js');

function flushAsync(n = 5): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise<void>((r) => setTimeout(r, 0)));
  return p;
}

async function exec(key: string, code: string): Promise<unknown> {
  return executeWasmoon(code, {}, { wasmoonKey: key, entry: 'callListenMain', args: [`ret:${code}`] });
}

describe('lua-wasmoon multi-slot cache', () => {
  test('same code reuses the warm engine (1 create, 1 compile)', async () => {
    const key = 'reuse-test';
    const code = 'return 1';
    const before = createdEngines.length;
    expect(await exec(key, code)).toBe('ret:return 1');
    expect(await exec(key, code)).toBe('ret:return 1');
    expect(await exec(key, code)).toBe('ret:return 1');
    expect(createdEngines.length).toBe(before + 1);
    expect(createdEngines[createdEngines.length - 1]!.doStringCalls.length).toBe(1);
  });

  test('different code creates a second slot without closing the first', async () => {
    const key = 'multi-slot-test';
    const before = createdEngines.length;
    expect(await exec(key, 'code-a')).toBe('ret:code-a');
    expect(await exec(key, 'code-b')).toBe('ret:code-b');
    expect(createdEngines.length).toBe(before + 2);
    await flushAsync();
    expect(createdEngines[before]!.closeCount()).toBe(0);
    expect(createdEngines[before + 1]!.closeCount()).toBe(0);
  });

  test('slot count is bounded and eviction closes the oldest engine (LRU)', async () => {
    const key = 'lru-test';
    const before = createdEngines.length;
    for (let i = 0; i < 70; i++) {
      expect(await exec(key, `code-${i}`)).toBe(`ret:code-${i}`);
    }
    expect(createdEngines.length).toBe(before + 70);
    await flushAsync(10);
    let closedCount = 0;
    for (let i = before; i < createdEngines.length; i++) {
      if (createdEngines[i]!.closeCount() > 0) closedCount++;
    }
    expect(closedCount).toBeGreaterThanOrEqual(6);
    const oldest = createdEngines[before]!;
    expect(oldest.closeCount()).toBeGreaterThan(0);
    const newestAllUnclosed = createdEngines.slice(before + 64).every((e) => e.closeCount() === 0);
    expect(newestAllUnclosed).toBe(true);
  });

  test('clearWasmoonEngine closes and drops slots for its logical key only', async () => {
    const keyA = 'clear-test-a';
    const keyB = 'clear-test-b';
    const before = createdEngines.length;
    await exec(keyA, 'shared-code');
    await exec(keyB, 'shared-code');
    expect(createdEngines.length).toBe(before + 2);
    clearWasmoonEngine(keyA);
    await flushAsync();
    expect(createdEngines[before]!.closeCount()).toBe(1);
    expect(createdEngines[before + 1]!.closeCount()).toBe(0);
    const mid = createdEngines.length;
    await exec(keyA, 'shared-code');
    expect(createdEngines.length).toBe(mid + 1);
    await exec(keyB, 'shared-code');
    expect(createdEngines.length).toBe(mid + 1);
  });

  test('per-slot execution remains serialized via the tail chain', async () => {
    const key = 'serialization-test';
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sharedCode = 'shared-entry-code';
    const slowRun = executeWasmoon(
      sharedCode,
      { hook: async () => {
          events.push('slow-start');
          await gate;
          events.push('slow-end');
        } },
      { wasmoonKey: key, entry: 'hook', args: [] },
    );
    const fastRun = executeWasmoon(
      sharedCode,
      { hook: async () => {
          events.push('fast-start');
        } },
      { wasmoonKey: key, entry: 'hook', args: [] },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['slow-start']);
    release();
    await slowRun;
    await fastRun;
    expect(events).toEqual(['slow-start', 'slow-end', 'fast-start']);
  });
});
