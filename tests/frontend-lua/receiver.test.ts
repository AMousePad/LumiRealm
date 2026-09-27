import { expect, test } from 'bun:test';
import { createFrontendLuaReceiver } from '../../src/frontend-lua/receiver.js';
import type { FrontendLuaCall, FrontendLuaReply } from '../../src/frontend-lua/protocol.js';

const call: FrontendLuaCall = { type: 'lua_call', sessionId: 'owner', requestId: 'request', chatId: 'chat', characterId: 'character', operation: { kind: 'button', value: 'expand' } };

test('a cancellation received before its delayed call prevents execution', async () => {
  let executions = 0;
  const receiver = createFrontendLuaReceiver('owner', async () => { executions++; }, () => {});
  await receiver.receive({ type: 'lua_cancel', sessionId: 'owner', requestId: 'request' });
  await receiver.receive(call);
  expect(executions).toBe(0);
});

test('a broadcast executes once in its owning document, including duplicate delivery after completion', async () => {
  let executions = 0;
  const replies: FrontendLuaReply[] = [];
  const run = async () => { executions++; return 'result'; };
  const owner = createFrontendLuaReceiver('owner', run, reply => replies.push(reply));
  const other = createFrontendLuaReceiver('other-tab', run, reply => replies.push(reply));
  await Promise.all([owner.receive(call), other.receive(call), owner.receive(call)]);
  await owner.receive(call);
  expect(executions).toBe(1);
  expect(replies).toEqual([{ type: 'lua_reply', sessionId: 'owner', requestId: 'request', ok: true, value: 'result' }]);
});

test('cancellation prevents a delayed service response from resuming mutation', async () => {
  const service = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let writes = 0;
  const replies: FrontendLuaReply[] = [];
  const receiver = createFrontendLuaReceiver('owner', async (_call, signal) => {
    started.resolve();
    await service.promise;
    signal.throwIfAborted();
    writes++;
  }, reply => replies.push(reply));
  const pending = receiver.receive(call);
  await started.promise;
  await receiver.receive({ type: 'lua_cancel', sessionId: 'owner', requestId: 'request' });
  service.resolve();
  await pending;
  expect(writes).toBe(0);
  expect(replies).toEqual([]);
});

test('teardown aborts work and cannot send a successful late reply', async () => {
  const service = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const replies: FrontendLuaReply[] = [];
  let signal!: AbortSignal;
  const receiver = createFrontendLuaReceiver('owner', async (_call, value) => {
    signal = value;
    started.resolve();
    await service.promise;
    return 'late';
  }, reply => replies.push(reply));
  const pending = receiver.receive(call);
  await started.promise;
  receiver.dispose();
  expect(signal.aborted).toBe(true);
  service.resolve();
  await pending;
  expect(replies).toEqual([]);
});
