import { expect, test } from 'bun:test';
import type { HostApi } from '../../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../../src/interpreter/runtime.js';
import { makeDispatcherScriptNS } from '../../../src/interpreter/dispatcher.js';
import { execute } from '../../../src/interpreter/lua-bridge.js';
import { loadGlobalVars } from '../../../src/interpreter/runtime/chat-state.js';
import { getRecentFlush, invalidateRecentFlush } from '../../../src/state/recent-flush-cache.js';

test('failed saves preserve pending variables and do not publish a successful cache entry', async () => {
  let fail = true;
  let saved: unknown = { count: '1' };
  const chatId = 'failed-save';
  const api = { chat: { setMetadata: async (_key: string, value: unknown) => {
    if (fail) throw new Error('Storage unavailable');
    saved = value;
  } } } as unknown as HostApi;
  const rt = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(execute), {
    chatId, preloaded: { varsCache: { $count: '1' }, globalVars: {}, messagesRaw: [], lorebook: { entries: [], primaryBookId: null } },
  });
  try {
    rt.setVar('count', '2');
    await expect(rt.flush()).rejects.toMatchObject({ name: 'VariablePersistenceError' });
    expect(saved).toEqual({ count: '1' });
    expect(getRecentFlush(chatId)).toBeNull();
    expect(rt.getVar('count')).toBe('2');
    fail = false;
    expect(await rt.flush()).toBe(true);
    expect(saved).toEqual({ count: '2' });
    expect(getRecentFlush(chatId)).toEqual({ $count: '2' });
    expect(await rt.flush()).toBe(false);
  } finally {
    invalidateRecentFlush(chatId);
  }
});

test('failed global variable reads preserve the cause instead of using empty state', async () => {
  const cause = new Error('Storage unavailable');
  const api = { chat: { getMetadata: async () => { throw cause; } } } as unknown as HostApi;
  await expect(loadGlobalVars(api)).rejects.toMatchObject({ name: 'VariablePersistenceError', cause });
  await expect(makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS()))
    .rejects.toMatchObject({ name: 'VariablePersistenceError', cause });
});
