import { expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge.js';

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('async workers dispatch before settlement and aggregate in input order', async () => {
  const first = deferred(), second = deferred();
  const calls: number[] = [];
  const run = execute(`
function probe()
  local shared = { next = 0 }
  local worker = async(function()
    shared.next = shared.next + 1
    local id = shared.next
    return work(id):await()
  end)
  return Promise.all({worker(), worker(), false, 'plain'}):await()
end`, { work: (id: number) => { calls.push(id); return id === 1 ? first.promise : second.promise; } }, { entry: 'probe' });
  try { expect(calls).toEqual([1, 2]); }
  finally { second.resolve('second'); first.resolve('first'); }
  expect(await run).toEqual(['first', 'second', false, 'plain']);
});

test('nested workers preserve shared Lua table identity', async () => {
  const result = await execute(`
function probe()
  local value = {count = 0}
  local inner = async(function()
    work():await()
    value.count = value.count + 1
    return value
  end)
  local outer = async(function() return inner():await() end)
  local result = outer():await()
  return {result == value, value.count}
end`, { work: () => Promise.resolve('ok') }, { entry: 'probe' });
  expect(result).toEqual([true, 1]);
});

for (const asynchronous of [false, true]) {
  test(`Lua pcall catches ${asynchronous ? 'async' : 'sync'} worker rejection`, async () => {
    const result = await execute(`
function probe()
  local worker = async(function() return work():await() end)
  local ok, err = pcall(function() return worker():await() end)
  return {ok, tostring(err)}
end`, { work: () => { if (asynchronous) return Promise.reject(new Error('mock failure')); throw new Error('mock failure'); } }, { entry: 'probe' });
    expect((result as unknown[])[0]).toBe(false);
    expect((result as unknown[])[1]).toContain('mock failure');
  });
}

test('aggregate rejects without waiting for an earlier pending worker', async () => {
  const first = deferred(), second = deferred();
  const run = execute(`
function probe()
  local worker = async(function(id) return work(id):await() end)
  return Promise.all({worker(1), worker(2)}):await()
end`, { work: (id: number) => id === 1 ? first.promise : second.promise }, { entry: 'probe' });
  second.reject(new Error('second failed'));
  const observed = expect(run).rejects.toThrow('second failed');
  try { await observed; } finally { first.resolve('late'); }
  await turn();
});

test('detached pending worker never resumes after VM close', async () => {
  const gate = deferred();
  const calls: string[] = [];
  expect(await execute(`
function probe()
  async(function() work():await(); record('resumed') end)()
  return 'done'
end`, { work: () => gate.promise, record: (value: string) => calls.push(value) }, { entry: 'probe' })).toBe('done');
  gate.resolve('late');
  await turn();
  expect(calls).toEqual([]);
});

test('finally waits for settlement and preserves value or rejection', async () => {
  const calls: string[] = [];
  const result = await execute(`
function probe()
  local p = async(function() return work():await() end)()
  local q = p:finally(function() record('finally') end)
  local v = q:await()
  local ok, err = pcall(function()
    return Promise.reject('rejected'):finally(function() record('rejected') end):await()
  end)
  return {v, ok, tostring(err)}
end`, { work: () => Promise.resolve('value'), record: (v: string) => calls.push(v) }, { entry: 'probe' });
  expect(calls).toEqual(['finally', 'rejected']);
  expect((result as unknown[]).slice(0, 2)).toEqual(['value', false]);
  expect((result as unknown[])[2]).toContain('rejected');
});

test('async entry adopts a returned worker promise', async () => {
  expect(await execute(`
local inner = async(function() return work():await() end)
probe = async(function() return inner() end)
`, { work: () => Promise.resolve('adopted') }, { entry: 'probe' })).toBe('adopted');
});

test('finally awaits returned workers and propagates callback errors', async () => {
  expect(await execute(`
function probe()
  local called = false
  local callback = async(function() work():await(); called = true end)
  local value = Promise.resolve('original'):finally(callback):await()
  local ok, err = pcall(function()
    return Promise.resolve('value'):finally(function() error('callback failure') end):await()
  end)
  return {value, called, ok, string.find(tostring(err), 'callback failure') ~= nil}
end`, { work: () => Promise.resolve('ok') }, { entry: 'probe' })).toEqual(['original', true, false, true]);
});

test('rejected detached host promise after entry error cannot resume Lua', async () => {
  const gate = deferred();
  const calls: string[] = [];
  await expect(execute(`
function probe()
  async(function() work():await(); record('late') end)()
  error('entry failure')
end`, { work: () => gate.promise, record: (value: string) => calls.push(value) }, { entry: 'probe' })).rejects.toThrow('entry failure');
  gate.reject(new Error('late failure'));
  await turn();
  expect(calls).toEqual([]);
});

test('worker rejection preserves Lua error object identity', async () => {
  expect(await execute(`
function probe()
  local marker = {reason = 'failed'}
  local worker = async(function() error(marker) end)
  local ok, err = pcall(function() return worker():await() end)
  return {ok, err == marker}
end`, {}, { entry: 'probe' })).toEqual([false, true]);
});
