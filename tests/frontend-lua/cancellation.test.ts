import { afterEach, expect, test } from 'bun:test';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';

afterEach(() => clearLuaEngines());

test('cancelling suspended Lua prevents its later setter and preserves the original reason', async () => {
  const started = Promise.withResolvers<void>();
  const service = Promise.withResolvers<string>();
  const controller = new AbortController();
  const writes: string[] = [];
  const result = execute('probe = async(function(id) local value = service():await(); setChatVar(id, "x", value) end)', {
    service: () => { started.resolve(); return service.promise; },
    setChatVar: (_id: string, _key: string, value: string) => { writes.push(value); },
  }, { entry: 'probe', enforceAccess: true, signal: controller.signal });
  const failed = result.catch(error => error);
  await started.promise;
  const reason = new Error('Generation stopped');
  controller.abort(reason);
  service.resolve('late');
  expect(await failed).toBe(reason);
  expect(writes).toEqual([]);
});

test('a queued cancelled callback never runs and a later call can reuse the mode', async () => {
  const started = Promise.withResolvers<void>();
  const service = Promise.withResolvers<void>();
  const controller = new AbortController();
  const calls: string[] = [];
  const code = 'probe = async(function() return service():await() end)';
  const opts = { entry: 'probe', mode: 'start' };
  const first = execute(code, { service: () => { started.resolve(); return service.promise; } }, opts);
  await started.promise;
  const second = execute(code, { service: async () => { calls.push('cancelled'); } }, { ...opts, signal: controller.signal }).catch(error => error);
  controller.abort(new Error('Cancelled in queue'));
  service.resolve();
  await first;
  expect(await second).toBe(controller.signal.reason);
  expect(await execute(code, { service: async () => { calls.push('next'); return 'ok'; } }, opts)).toBe('ok');
  expect(calls).toEqual(['next']);
});
