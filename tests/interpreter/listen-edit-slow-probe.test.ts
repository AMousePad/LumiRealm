import { describe, test, expect, afterEach } from 'bun:test';
import { runListenEditChain, type ListenEditTrigger } from '../../src/interpreter/listen-edit.js';
import type { HostApi, ScriptNS, DispatchData, HostMessage } from '../../src/interpreter/host.js';
import { makeRisuRegexRuntime, makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import { logStore } from '../../src/log/store.js';

// ─── Slow-chain attribution ───────────────────────────────────────────────
//
// The host drops an interceptor result wholesale when the wall-clock budget
// passes, so a slow listenEdit chain is invisible apart from one host console
// error. These tests pin the probe that makes the overrun self-reporting:
// host-API wait is separated from pure Lua, and the report names the slowest
// API methods.

function makeMockScriptNS(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error('mock require: unknown ' + name);
    },
  } as unknown as ScriptNS;
}

interface MockApiState {
  calls: number;
}

function makeMockHostApi(state: MockApiState, delayMs = 0): HostApi {
  const messages: HostMessage[] = [];
  return {
    chat: {
      getMessages: async () => messages,
      sendMessage: async () => ({ id: 'mock' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => null,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
    ui: {
      prompt: async () => {
        state.calls += 1;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        return 'ok';
      },
    },
  } as unknown as HostApi;
}

const dispatchData: DispatchData = { characterId: 'c-test' };

function warns(prefix: string): string[] {
  return logStore
    .snapshot()
    .events.filter((e) => e.level === 'warn' && e.message.includes(prefix))
    .map((e) => e.message);
}

afterEach(() => {
  logStore.setState({ enabled: false });
  logStore.clear();
});

describe('runListenEditChain — slow-path probe', () => {
  test('reports pure Lua time when the trigger itself is slow', async () => {
    logStore.setState({ enabled: true, level: 'warn', includeChatData: true });
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `
listenEdit('editRequest', function(id, v, m)
  local acc = 0
  for i = 1, 400000 do acc = acc + i end
  return v
end)
`,
      },
    ];
    await runListenEditChain(
      triggers,
      'editRequest',
      [{ role: 'user', content: 'hi' }],
      {},
      makeMockHostApi({ calls: 0 }),
      dispatchData,
      makeMockScriptNS(),
      { slowTriggerWarnMs: 1, slowChainWarnMs: 1, chatId: 'chat-slow' },
    );

    const trigger = warns('slow trigger[0]');
    expect(trigger.length).toBe(1);
    expect(trigger[0]).toContain('mode=editRequest');
    // The hook makes no host call of its own, so the time is Lua execution:
    // api wait must stay at 0 ms and no cbs() resolution may be counted.
    expect(trigger[0]).toContain('api=0ms');
    expect(trigger[0]).toContain('cbs=0ms/0calls');
    expect(warns('slow chain').length).toBe(1);
  });

  test('attributes host-API wait and names the slowest methods', async () => {
    logStore.setState({ enabled: true, level: 'warn', includeChatData: true });
    const state: MockApiState = { calls: 0 };
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `
listenEdit('editRequest', function(id, v, m)
  alertInput('one'):await()
  alertInput('two'):await()
  alertInput('three'):await()
  return v
end)
`,
      },
    ];
    await runListenEditChain(
      triggers,
      'editRequest',
      [{ role: 'user', content: 'hi' }],
      {},
      makeMockHostApi(state, 15),
      dispatchData,
      makeMockScriptNS(),
      { slowTriggerWarnMs: 1, slowChainWarnMs: 1, chatId: 'chat-slow' },
    );

    const trigger = warns('slow trigger[0]');
    expect(trigger.length).toBe(1);
    // Three Lua-visible awaits land on api.ui.prompt, and the report must name
    // that method with its call count instead of blaming the whole chain.
    expect(state.calls).toBe(3);
    expect(trigger[0]).toContain('api=');
    // 3 ui.prompt calls from the hook + 1 characters.get from the runtime factory.
    expect(trigger[0]).toContain('/4calls');
    expect(trigger[0]).toMatch(/top=\[[^\]]*ui\.prompt=3calls\/\d+ms/);
    const chain = warns('slow chain');
    expect(chain.length).toBe(1);
    expect(chain[0]).toContain('api_sum=');
    expect(chain[0]).toContain('/4calls');
  });

  test('stays quiet below the thresholds', async () => {
    logStore.setState({ enabled: true, level: 'warn', includeChatData: true });
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editRequest', function(id, v, m) return v end)`,
      },
    ];
    await runListenEditChain(
      triggers,
      'editRequest',
      [{ role: 'user', content: 'hi' }],
      {},
      makeMockHostApi({ calls: 0 }),
      dispatchData,
      makeMockScriptNS(),
      { chatId: 'chat-quiet' },
    );
    expect(warns('slow trigger')).toEqual([]);
    expect(warns('slow chain')).toEqual([]);
  });

  test('keeps the chain result and API return values identical when wrapped', async () => {
    logStore.setState({ enabled: false });
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editRequest', function(id, v, m) return v .. ' ok' end)`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editRequest',
      'start' as unknown as { role: string; content: string }[],
      {},
      makeMockHostApi({ calls: 0 }),
      dispatchData,
      makeMockScriptNS(),
      { chatId: 'chat-plain' },
    );
    // The hook appended to a string; JSON round-trip through Lua must survive.
    expect(String(out)).toBe('start ok');
  });
});
