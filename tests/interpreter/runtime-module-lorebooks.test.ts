import { describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import type { HostApi, ScriptNS } from '../../src/interpreter/host.js';

function scriptNs(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error(name);
    },
  } as unknown as ScriptNS;
}

function makeMockHostApi(): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: '1' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      showSelection: async () => null,
      getMetadata: async () => undefined,
      setMetadata: async () => {},
      inject: async () => {},
    },
    variables: {
      get: async () => null,
      set: async () => {},
      getAll: async () => ({}),
      getGlobal: async (k: string) => (k === 'toggle_Card.Encode' ? '0' : null),
      setGlobal: async () => {},
      getAllGlobal: async () => ({ 'toggle_Card.Encode': '0' }),
    },
    characters: {
      get: async (id: string) => ({ id, name: 'TestChar', worldBookIds: [] }),
      update: async () => {},
    },
  } as unknown as HostApi;
}

describe('Runtime Module Lorebooks and getLoreBooks', () => {
  test('resolves module lorebook entries and evaluates CBS macros in getLoreBooks', async () => {
    const api = makeMockHostApi();

    const moduleLorebooks = [
      {
        id: 'lore-1',
        comment: 'Card.Core.axLLM',
        content: '{{#if_pure {{equal::{{getglobalvar::toggle_Card.Encode}}::2}}}}BASE64{{/if_pure}}NORMAL_PROMPT',
        key: 'core, axllm',
      },
      {
        id: 'lore-2',
        comment: 'Card.Image.axLLM',
        content: 'IMAGE_PROMPT_CONTENT',
        key: 'image',
      },
    ];

    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'char-1' }, scriptNs(), {
      characterId: 'char-1',
      lowLevelAccess: true,
      moduleLorebooks,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local core = getLoreBooks(triggerId, 'Card.Core.axLLM')
        local img = getLoreBooks(triggerId, 'Card.Image.axLLM')
        local out = core[1].comment .. '|' .. core[1].content .. '|' .. img[1].content
        setChatVar(triggerId, 'result', out)
      end
    `);

    expect(runtime.getVar('result')).toBe('Card.Core.axLLM|NORMAL_PROMPT|IMAGE_PROMPT_CONTENT');
  });

  test('loadLoreBooks returns all entries as objects with name and content', async () => {
    const api = makeMockHostApi();

    const moduleLorebooks = [
      {
        id: 'lore-1',
        comment: 'Card.Core.axLLM',
        content: 'CORE_CONTENT',
      },
      {
        id: 'lore-2',
        comment: 'Card.Image.axLLM',
        content: 'IMAGE_CONTENT',
      },
    ];

    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'char-1' }, scriptNs(), {
      characterId: 'char-1',
      lowLevelAccess: true,
      moduleLorebooks,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local allBooks = loadLoreBooks(triggerId)
        local out = #allBooks .. '|' .. allBooks[1].name .. '|' .. allBooks[1].content
        setChatVar(triggerId, 'result', out)
      end
    `);

    expect(runtime.getVar('result')).toBe('2|Card.Core.axLLM|CORE_CONTENT');
  });

  test('loaded lore data reaches the auxiliary model through awaited prompt assembly', async () => {
    const requests: unknown[] = [];
    const api: HostApi = {
      ...makeMockHostApi(),
      llm: { generate: async (request) => {
        requests.push(request);
        return { content: 'Synthetic result' };
      } },
    };
    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'char-1' }, scriptNs(), {
      characterId: 'char-1', lowLevelAccess: true,
      moduleLorebooks: [{ id: 'lore-1', content: 'Oak {{user}}' }],
    });
    await runtime.runLua(`
      function onRun(id)
        local worker = async(function()
          local books = loadLoreBooks(id, 100)
          local prompt = {}
          for _, book in ipairs(books) do
            table.insert(prompt, {role = 'user', content = book.data:gsub('Oak', 'Pine')})
          end
          local response = axLLM(id, prompt)
          assert(response.success)
          setChatVar(id, 'result', response.result)
        end)
        Promise.all({worker()}):await()
      end
    `);
    expect(requests).toEqual([{ messages: [{ role: 'user', content: 'Pine User' }] }]);
    expect(runtime.getVar('result')).toBe('Synthetic result');
  });
});
