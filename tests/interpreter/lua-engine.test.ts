import { afterEach, expect, test } from 'bun:test';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';
import { LuaCallbackError, LuaChunkError } from '../../src/interpreter/lua-engine.js';

afterEach(async () => { await clearLuaEngines(); await clearLuaEngines('other-user'); });
const options = { entry: 'probe', mode: 'start', enforceAccess: true } as const;

test('Risu serializes simultaneous calls and retains only the current source per mode', async () => {
  const code = 'counter = 0; probe = async(function() local n = counter; pause():await(); counter = n + 1; return counter end)';
  const globals = { pause: async () => { await Promise.resolve(); } };
  expect(await Promise.all(Array.from({ length: 4 }, () => execute(code, globals, options)))).toEqual([1, 2, 3, 4]);
  expect(await execute(code, globals, { ...options, mode: 'output' })).toBe(1);
  expect(await execute(code, globals, { ...options, scope: 'other-user' })).toBe(1);
  await execute('function probe() end', {}, options);
  expect(await execute(code, globals, options)).toBe(1);
});

test('Risu grants display keys variable writes but denies safe and low-level APIs', async () => {
  const calls: string[] = [];
  const globals = {
    setChatVar: () => { calls.push('var'); },
    setChat: () => { calls.push('chat'); },
    getDescription: () => { calls.push('description'); },
    simpleLLM: async () => { calls.push('llm'); return 'unexpected'; },
  };
  const code = `probe = async(function(id)
    setChatVar('forged', 'x', 'no'); setChatVar(id, 'x', 'yes')
    setChat(id, 0, 'no'); local description = getDescription(id)
    return type(description)..'|'..type(simpleLLM(id, 'no'):await())
  end)`;
  expect(await execute(code, globals, { ...options, mode: 'editDisplay', lowLevelAccess: true })).toBe('nil|nil');
  expect(calls).toEqual(['var']);
  calls.length = 0;
  await execute(code, globals, { ...options, lowLevelAccess: true });
  expect(calls).toEqual(['var', 'chat', 'description', 'llm']);
});

test('safe keys expire after callbacks and top-level writes cannot forge permission', async () => {
  const writes: unknown[] = [];
  const code = `setChatVar('forged', 'x', 'top')
    function probe(id)
      if previous then setChatVar(previous, 'x', 'old') end
      setChatVar(id, 'x', 'current'); previous = id
    end`;
  const globals = { setChatVar: (_id: string, _key: string, value: unknown) => { writes.push(value); } };
  await execute(code, globals, options); await execute(code, globals, options);
  expect(writes).toEqual(['current', 'current']);
});

test('Risu retains display keys after a callback, including across source changes', async () => {
  let saved: unknown;
  const writes: string[] = [];
  await execute('function probe(id) save(id) end', { save: (id: unknown) => { saved = id; } }, { ...options, mode: 'editDisplay' });
  await execute('setChatVar(saved, "x", "retained")', {
    saved, setChatVar: (_id: string, _key: string, value: string) => { writes.push(value); },
  }, { ...options, mode: 'editDisplay' });
  expect(writes).toEqual(['retained']);
});

test('Risu records a failed source and preserves definitions made before its error', async () => {
  const code = 'function probe() return "defined" end; error("initialization")';
  await expect(execute(code, {}, options)).rejects.toBeInstanceOf(LuaChunkError);
  expect(await execute(code, {}, options)).toBe('defined');
  await expect(execute('probe = 42', {}, options)).rejects.toBeInstanceOf(LuaCallbackError);
  expect(await execute('probe = false', {}, options)).toBeUndefined();
  expect(await execute('function probe() return "recovered" end', {}, options)).toBe('recovered');
});

test('Risu retains the source-loading closure for stopChat and setDescription data validation', async () => {
  const stopped: number[] = [];
  const code = 'function probe(id) stopChat(id) end';
  await execute(code, { stopChat: () => { stopped.push(1); } }, options);
  await execute(code, { stopChat: () => { stopped.push(2); } }, options);
  expect(stopped).toEqual([1, 1]);
  const setter = 'function probe(id) setDescription(id, "value") end';
  await expect(execute(setter, { setDescription() {} }, { ...options, data: [] })).rejects.toBeInstanceOf(LuaCallbackError);
  await expect(execute(setter, { setDescription() {} }, { ...options, data: 'later' })).rejects.toBeInstanceOf(LuaCallbackError);
});

test('closing a busy scope waits for its callback without deleting a newly opened scope', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  const running = execute('probe = async(function() return pause():await() end)', { pause: () => { entered(); return pause; } }, options);
  await started;
  const closed = clearLuaEngines();
  const code = 'n = 0; function probe() n = n + 1; return n end';
  expect(await execute(code, {}, options)).toBe(1);
  release(); await running; await closed;
  expect(await execute(code, {}, options)).toBe(2);
});
