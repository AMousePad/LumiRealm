import { describe, test, expect } from 'bun:test';
import {
  runListenEditChain,
  type ListenEditTrigger,
} from '../../src/interpreter/listen-edit.js';
import type { HostApi, ScriptNS, DispatchData, HostMessage } from '../../src/interpreter/host.js';
import { makeRisuRegexRuntime, makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';

// listenEdit chains run against the preloaded snapshot, which only carries the
// character's own world books. Module lorebooks (a module's own lore rows, such
// as a shared Lua library the module loads by comment) must reach the hook too,
// or a module that resolves its library through getLoreBooks throws inside
// callListenMain. Risu's getLoreBooksMain searches module lore for every hook.

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
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error('mock require: unknown ' + name);
    },
  } as unknown as ScriptNS;
}

const dispatchData: DispatchData = { characterId: 'c-test' };

// Neutral stand-in for a module library loaded out of module lore by comment.
const PRELUDE_LIBRARY = [
  {
    id: 'module-lore-1',
    comment: 'Card.Prelude',
    content: 'local M = {} function M.trim(v) return (v:gsub("^%s+", ""):gsub("%s+$", "")) end return M',
  },
];

function preludeHook(mode: 'editRequest' | 'editDisplay'): ListenEditTrigger {
  return {
    source: { effect: [{ type: 'triggerlua' }] },
    luaCode: `
listenEdit('${mode}', function(id, data, meta)
  local source = getLoreBooks(id, 'Card.Prelude')
  if not source or #source == 0 then error('Failed to load Card.Prelude.') end
  local library = load(source[1].content, '@prelude', 't')()
  return data .. '|' .. library.trim('  trimmed  ')
end)
`,
  };
}

function countHook(): ListenEditTrigger {
  return {
    source: { effect: [{ type: 'triggerlua' }] },
    luaCode: `
listenEdit('editRequest', function(id, data, meta)
  return data .. '#' .. #getLoreBooks(id, 'Card.Prelude')
end)
`,
  };
}

describe('runListenEditChain module lorebooks', () => {
  test('editRequest hook resolves a module library passed through the chain options', async () => {
    const out = await runListenEditChain(
      [preludeHook('editRequest')],
      'editRequest',
      'value',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
      { moduleLorebooks: PRELUDE_LIBRARY },
    );
    expect(out).toBe('value|trimmed');
  });

  test('editDisplay hook resolves a module library passed through the chain options', async () => {
    const out = await runListenEditChain(
      [preludeHook('editDisplay')],
      'editDisplay',
      'value',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
      { moduleLorebooks: PRELUDE_LIBRARY },
    );
    expect(out).toBe('value|trimmed');
  });

  test('module lore is appended once per trigger and does not accumulate across the chain', async () => {
    const out = await runListenEditChain(
      [countHook(), countHook()],
      'editRequest',
      'value',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
      { moduleLorebooks: PRELUDE_LIBRARY },
    );
    expect(out).toBe('value#1#1');
  });

  test('character lore in the preloaded snapshot stays visible alongside module lore', async () => {
    const out = await runListenEditChain(
      [{
        source: { effect: [{ type: 'triggerlua' }] },
        luaCode: `
listenEdit('editRequest', function(id, data, meta)
  local host = getLoreBooks(id, 'Card.Host')
  local module = getLoreBooks(id, 'Card.Prelude')
  return data .. '|host=' .. #host .. '|module=' .. #module
end)
`,
      }],
      'editRequest',
      'value',
      {},
      makeMockHostApi(),
      dispatchData,
      makeMockScriptNS(),
      {
        preloaded: { lorebook: { entries: [{ id: 'host-lore-1', comment: 'Card.Host', content: 'host row' }], primaryBookId: 'book-1' } },
        moduleLorebooks: PRELUDE_LIBRARY,
      },
    );
    expect(out).toBe('value|host=1|module=1');
  });
});
