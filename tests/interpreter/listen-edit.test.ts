import { describe, test, expect } from 'bun:test';
import {
  runListenEditChain,
  type ListenEditMode,
  type ListenEditTrigger,
} from '../../src/interpreter/listen-edit.js';
import type { HostApi, ScriptNS, DispatchData, HostMessage } from '../../src/interpreter/host.js';
import { makeRisuRegexRuntime, makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';

// ─── Phase 6 — listenEdit orchestrator tests ─────────────────────────────
//
// Verifies:
//   1. Filter — non-triggerlua triggers are skipped.
//   2. Chain — output of trigger N feeds trigger N+1.
//   3. JSON round-trip — string values survive JSON encode/decode through
//      the Lua prelude's `callListenMain`.
//   4. Per-trigger isolation — one bad hook doesn't kill siblings.
//   5. No-op when no listenEdit hooks are registered.
//
// Tests run upstream Wasmoon via the lua-bridge without host
// dependencies. HostApi is a minimal in-memory mock; listenEdit
// hooks generally don't touch chat APIs (lowLevelAccess is hardcoded
// false at edit-time per Risu scriptings.ts:1390).

function makeMockHostApi(messages: HostMessage[] = []): HostApi {
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
  };
}

function makeMockScriptNS(): ScriptNS {
  return {
    require: async (name: string) => {
      // Provide the risu-compat / risu-compat-lua libraries the runtime
      // expects. Both are referenced by makeRisuTriggerRuntime/runLua.
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error('mock require: unknown ' + name);
    },
  } as unknown as ScriptNS;
}

const dispatchData: DispatchData = { characterId: 'c-test' };

// Risu's runLuaEditTrigger preserves nullish results between scripts, after luaCodeWrapper threads listeners within each script.
describe('listenEdit nullish script results', () => {
  async function runChain(mode: ListenEditMode, codes: string[], value: unknown) {
    const api = makeMockHostApi();
    const metadata = new Map<string, unknown>();
    api.chat.getMetadata = async key => metadata.get(key) ?? null;
    api.chat.setMetadata = async (key, next) => { metadata.set(key, structuredClone(next)); };
    const output = await runListenEditChain(
      codes.map(luaCode => ({ source: { effect: [{ type: 'triggerlua' }] }, luaCode })),
      mode, value, {}, api, dispatchData, makeMockScriptNS(),
    );
    return { output, metadata };
  }

  for (const mode of ['editInput', 'editOutput', 'editDisplay', 'editRequest'] as const) {
    test(`${mode} keeps prior transformed output and flushes a nil-returning script's writes`, async () => {
      const request = mode === 'editRequest';
      const input = request ? [{ role: 'user', content: 'Input' }] : 'Input';
      const result = await runChain(mode, [
        `listenEdit('${mode}', function(id, v)
          ${request ? "v[1].content = v[1].content .. ' edited'; return v" : "return v .. ' edited'"}
        end)`,
        `listenEdit('${mode}', function(id, v) setChatVar(id, 'touched', '1'); return nil end)`,
        `listenEdit('${mode}', function(id, v) return v end)`,
      ], input);
      expect(result.output).toEqual(request ? [{ role: 'user', content: 'Input edited' }] : 'Input edited');
      expect(result.metadata.get('chat_variables')).toEqual({ touched: '1' });
    });

    test(`${mode} passes nil to the next listener inside the same script`, async () => {
      const result = await runChain(mode, [
        `listenEdit('${mode}', function(id, v) return nil end)
         listenEdit('${mode}', function(id, v) return type(v) end)`,
      ], mode === 'editRequest' ? [{ role: 'user', content: 'Input' }] : 'Input');
      expect(result.output).toBe('nil');
    });
  }

  test('an implicit nil return preserves the input', async () => {
    const result = await runChain('editOutput', [
      `listenEdit('editOutput', function(id, v) end)`,
    ], 'Input');
    expect(result.output).toBe('Input');
  });

  for (const [luaValue, expected] of [['false', false], ['0', 0], ["''", '']] as const) {
    test(`a later nil result preserves the earlier ${luaValue} result`, async () => {
      const result = await runChain('editOutput', [
        `listenEdit('editOutput', function(id, v) return ${luaValue} end)`,
        `listenEdit('editOutput', function(id, v) return nil end)`,
      ], 'Input');
      expect(result.output).toBe(expected);
    });
  }
});

describe('runListenEditChain — Phase 6', () => {
  test('returns input unchanged when no triggers', async () => {
    const out = await runListenEditChain(
      [],
      'editDisplay',
      'hello',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('hello');
  });

  test('skips non-triggerlua triggers', async () => {
    const triggers: ListenEditTrigger[] = [
      { source: { effect: [{ type: 'v2RunLLM' }] }, luaCode: 'unused' },
      { source: { effect: [{ type: 'setvar' }] }, luaCode: 'unused' },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'hello',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('hello');
  });

  test('mutates value via single editDisplay hook', async () => {
    const luaCode = `
listenEdit('editDisplay', function(id, value, meta)
  return value .. ' [edited]'
end)
`;
    const triggers: ListenEditTrigger[] = [
      { source: { effect: [{ type: 'triggerlua' }] }, luaCode },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'hello',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('hello [edited]');
  });

  test('chains output through multiple triggerlua triggers', async () => {
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editOutput', function(id, v, m) return v .. ' A' end)`,
      },
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editOutput', function(id, v, m) return v .. ' B' end)`,
      },
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editOutput', function(id, v, m) return v .. ' C' end)`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editOutput',
      'start',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('start A B C');
  });

  test('per-trigger isolation — bad hook does not nuke siblings', async () => {
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editDisplay', function(id, v, m) return v .. ' OK' end)`,
      },
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editDisplay', function(id, v, m) error('boom') end)`,
      },
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editDisplay', function(id, v, m) return v .. ' AFTER' end)`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'init',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    // First trigger appended ' OK'. Second threw — chain step dropped,
    // value carried forward. Third appended ' AFTER'.
    expect(out).toBe('init OK AFTER');
  });

  test('hook for a different mode does not fire', async () => {
    // Card registers an editInput hook but we run editDisplay.
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `listenEdit('editInput', function(id, v, m) return v .. ' INPUT' end)`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'hello',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('hello'); // editInput hook didn't fire on editDisplay
  });

  test('meta is passed through and accessible inside hook', async () => {
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `
listenEdit('editDisplay', function(id, v, m)
  return v .. ' idx=' .. tostring(m.index)
end)
`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'msg',
      { index: 7 },
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('msg idx=7');
  });

  test('Lua getGlobalVar reads the global bag rather than local chat variables', async () => {
    const api = makeMockHostApi();
    api.chat.getMetadata = async (key: string) => {
      if (key === 'chat_variables') return { same: 'local' };
      if (key === 'macro_variables') return { global: { same: 'global' } };
      return null;
    };
    const out = await runListenEditChain(
      [{
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `
listenEdit('editDisplay', function(id, v, m)
  return v .. '|' .. getGlobalVar(id, 'same') .. '|' .. getGlobalVar(id, 'missing')
end)
`,
      }],
      'editDisplay',
      'value',
      {},
      api,
      dispatchData,
      makeMockScriptNS(),
    );

    expect(out).toBe('value|global|null');
  });

  test('triggers without listenEdit hook are silent no-ops', async () => {
    // The Lua chunk runs but never calls listenEdit. The prelude's
    // editXxxFuncs arrays stay empty. callListenMain returns the
    // original value unchanged (json.encode of input == json.encode of
    // unmutated value).
    const triggers: ListenEditTrigger[] = [
      {
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `function onOutput(id) return id end`,
      },
    ];
    const out = await runListenEditChain(
      triggers,
      'editDisplay',
      'unchanged',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(out).toBe('unchanged');
  });

  test('a state decode error preserves prior output and skips the rest of its callback', async () => {
    const api = makeMockHostApi();
    let variables: unknown = { __broken: 'invalid json' };
    api.chat.getMetadata = async key => key === 'chat_variables' ? variables : null;
    api.chat.setMetadata = async (key, value) => { if (key === 'chat_variables') variables = value; };
    const output = await runListenEditChain([
      { source: { effect: [{ type: 'triggerlua' }] }, luaCode:
        `listenEdit('editOutput', function(id, v) return v .. ' before' end)` },
      { source: { effect: [{ type: 'triggerlua' }] }, luaCode:
        `listenEdit('editOutput', function(id, v)
          getState(id, 'broken')
          setChatVar(id, 'unreached', '1')
          return 'Discarded'
        end)` },
      { source: { effect: [{ type: 'triggerlua' }] }, luaCode:
        `listenEdit('editOutput', function(id, v) return v .. ' after' end)` },
    ], 'editOutput', 'Input', {}, api, dispatchData, makeMockScriptNS());
    expect(output).toBe('Input before after');
    expect(variables).toEqual({ __broken: 'invalid json' });
  });
});
