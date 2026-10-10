import { expect, test } from 'bun:test';
import { createFrontendLuaRpc } from '../../src/frontend-lua/rpc';
import { FrontendLuaExecutionError, FrontendLuaUnavailableError, type FrontendLuaCall } from '../../src/frontend-lua/protocol';

const input = { sessionId: 'tab-a', chatId: 'chat', characterId: 'character', operation: { kind: 'button' as const, value: 'toggle' } };

test('a synchronous reply settles even if its delivery subsequently throws', async () => {
  const rpc = createFrontendLuaRpc(message => {
    if (message.type !== 'lua_call') return;
    rpc.reply('user-a', { ...message, type: 'lua_reply', ok: true, value: 'received' });
    throw new Error('Transport closed after delivery');
  });
  expect(await rpc.call('user-a', input, { timeoutMs: 1000 })).toBe('received');
  expect(rpc.pendingCount).toBe(0);
});

test('only the addressed user and browser can complete a hook chain, exactly once', async () => {
  let sent!: FrontendLuaCall;
  const rpc = createFrontendLuaRpc(message => { if (message.type === 'lua_call') sent = message; });
  const result = rpc.call('user-a', input, { timeoutMs: 1000 });
  const reply = { type: 'lua_reply' as const, sessionId: input.sessionId, requestId: sent.requestId, ok: true as const, value: { changed: true } };
  expect(rpc.reply('user-b', reply)).toBe(false);
  expect(rpc.reply('user-a', { ...reply, sessionId: 'tab-b' })).toBe(false);
  expect(rpc.pendingCount).toBe(1);
  expect(rpc.reply('user-a', reply)).toBe(true);
  expect(rpc.reply('user-a', reply)).toBe(false);
  expect(await result).toEqual({ changed: true });
  expect(rpc.pendingCount).toBe(0);
});

test('cancellation rejects and late results never replay a completed operation', async () => {
  const sent: any[] = [], controller = new AbortController();
  const rpc = createFrontendLuaRpc(message => sent.push(message));
  const result = rpc.call('user-a', input, { timeoutMs: 1000, signal: controller.signal });
  const rejected = result.catch(error => error);
  controller.abort(); expect(await rejected).toBeInstanceOf(FrontendLuaUnavailableError);
  expect(sent.map(message => message.type)).toEqual(['lua_call', 'lua_cancel']);
  expect(rpc.reply('user-a', { type: 'lua_reply', sessionId: input.sessionId, requestId: sent[0].requestId, ok: true, value: 'late' })).toBe(false);
  expect(rpc.pendingCount).toBe(0);
});

test('frontend errors propagate and do not fall back to backend execution', async () => {
  let sent!: FrontendLuaCall;
  const rpc = createFrontendLuaRpc(message => { if (message.type === 'lua_call') sent = message; });
  const result = rpc.call('user-a', input, { timeoutMs: 1000 });
  const rejected = result.catch(error => error);
  rpc.reply('user-a', { type: 'lua_reply', sessionId: input.sessionId, requestId: sent.requestId, ok: false, error: 'engine failed' });
  expect(await rejected).toBeInstanceOf(FrontendLuaExecutionError);
});

test('disconnect only rejects calls belonging to that user and browser', async () => {
  const sent: FrontendLuaCall[] = [];
  const rpc = createFrontendLuaRpc(message => { if (message.type === 'lua_call') sent.push(message); });
  const a = rpc.call('user-a', input, { timeoutMs: 1000 });
  const b = rpc.call('user-b', input, { timeoutMs: 1000 });
  const rejected = a.catch(error => error);
  rpc.disconnect('user-a', input.sessionId); expect(await rejected).toBeInstanceOf(FrontendLuaUnavailableError);
  expect(rpc.pendingCount).toBe(1);
  rpc.reply('user-b', { type: 'lua_reply', sessionId: input.sessionId, requestId: sent[1]!.requestId, ok: true, value: 7 });
  expect(await b).toBe(7);
});

test('a dead transport cannot prevent cancellation cleanup', async () => {
  const controller = new AbortController();
  const rpc = createFrontendLuaRpc(message => { if (message.type === 'lua_cancel') throw Error('Socket closed'); });
  const pending = rpc.call('user-a', input, { timeoutMs: 1000, signal: controller.signal }).catch(error => error);
  expect(() => controller.abort()).not.toThrow();
  expect(await pending).toBeInstanceOf(FrontendLuaUnavailableError);
  expect(rpc.pendingCount).toBe(0);
});

test('missing owners and invalid deadlines fail before anything is sent', async () => {
  let sends = 0;
  const rpc = createFrontendLuaRpc(() => { sends++; });
  expect(await rpc.call('', input, { timeoutMs: 1000 }).catch(error => error)).toBeInstanceOf(FrontendLuaUnavailableError);
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    expect(await rpc.call('user-a', input, { timeoutMs }).catch(error => error)).toBeInstanceOf(RangeError);
  }
  expect(sends).toBe(0);
});
