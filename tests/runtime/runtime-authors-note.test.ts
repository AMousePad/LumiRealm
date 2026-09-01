import { describe, test, expect } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import type { HostApi, ScriptNS, DispatchData } from '../../src/interpreter/host.js';

// Risu's `setAuthorNote(value)` / `getAuthorNote()` Lua API maps to Lumi's
// `chat.metadata.authors_note: {content, depth, role, position}` slot
// consumed at [prompt-assembly.service.ts:1992]. Without this sync, Lua
// changes to author's-note land only in the legacy `__risu_author_note__`
// chat var and never reach the prompt.

interface MockState {
  metadata: Record<string, unknown>;
  characterName?: string;
  characterDescription?: string;
  characterFirstMessage?: string;
  characterUpdates?: Array<Record<string, unknown>>;
  personaDescription?: string;
}

function makeMockHostApi(state: MockState): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: 'mock' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async (key: string) => state.metadata[key],
      setMetadata: async (key: string, value: unknown) => {
        state.metadata[key] = value;
      },
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({
        id,
        name: state.characterName ?? '',
        description: state.characterDescription ?? '',
        firstMessage: state.characterFirstMessage ?? '',
      }),
      update: async (_id: string, patch: Record<string, unknown>) => {
        state.characterUpdates?.push(patch);
      },
    },
    personas: {
      getActive: async () => ({ id: 'persona-1', description: state.personaDescription ?? '' }),
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

const dispatchData: DispatchData = { characterId: 'c-test', chatId: 'chat-1' };

describe('runtime.setAuthorNote — Lumi authors_note sync', () => {
  test('writes to chat.metadata.authors_note with default depth/role', async () => {
    const state: MockState = { metadata: {} };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('keep responses concise');
    expect(state.metadata['authors_note']).toEqual({
      content: 'keep responses concise',
      depth: 4,
      role: 'system',
      position: 0,
    });
  });

  test('preserves existing depth + role when overwriting content', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: 'old', depth: 8, role: 'user', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('new');
    expect(state.metadata['authors_note']).toEqual({
      content: 'new',
      depth: 8,
      role: 'user',
      position: 0,
    });
  });

  test('coerces non-string value via toStr', async () => {
    const state: MockState = { metadata: {} };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote(42);
    expect((state.metadata['authors_note'] as { content: string }).content).toBe('42');
  });

  test('coerces invalid prior depth → 4', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: 'old', depth: 'bad', role: 'system', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('new');
    expect((state.metadata['authors_note'] as { depth: number }).depth).toBe(4);
  });

  test('coerces invalid prior role → "system"', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: 'old', depth: 4, role: 'narrator', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('new');
    expect((state.metadata['authors_note'] as { role: string }).role).toBe('system');
  });

  test('best-effort: setMetadata throwing does NOT break the call', async () => {
    const api: HostApi = {
      chat: {
        getMessages: async () => [],
        sendMessage: async () => ({ id: 'mock' }),
        editMessage: async () => {},
        deleteMessage: async () => {},
        getMetadata: async () => null,
        setMetadata: async (key: string) => {
          if (key === 'authors_note') throw new Error('lumi rejected');
          // Other keys (the chat-var flush) should continue to succeed.
        },
        inject: async () => {},
      },
      characters: { get: async (id: string) => ({ id }), update: async () => {} },
    };
    const rt = await makeRisuTriggerRuntime(api, dispatchData, makeMockScriptNS());
    // Should not throw — the chat-var write still succeeds.
    await rt.setAuthorNote('value');
  });
});

describe('runtime.getAuthorNote — Lumi authors_note read', () => {
  test('prefers chat.metadata.authors_note.content over chat var', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: 'from authors_note', depth: 4, role: 'system', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(await rt.getAuthorNote()).toBe('from authors_note');
  });

  test('falls back to legacy chat var when authors_note missing', async () => {
    // Legacy var lives under META_ROOT.local.__risu_author_note__.
    // Set it via setAuthorNote first (which writes both surfaces), then
    // delete authors_note to simulate stale state.
    const state: MockState = { metadata: {} };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('legacy value');
    delete state.metadata['authors_note'];
    expect(await rt.getAuthorNote()).toBe('legacy value');
  });

  test('returns Risu null-sentinel when neither surface has content', async () => {
    // Risu convention: missing chat vars resolve to literal "null" string,
    // not "" — cards branch on `{{getvar::X}} != null`. The legacy chat-var
    // fallback at the end of getAuthorNote preserves that sentinel.
    const state: MockState = { metadata: {} };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    expect(await rt.getAuthorNote()).toBe('null');
  });

  test('treats authors_note with empty content as missing (falls back)', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: '', depth: 4, role: 'system', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.setAuthorNote('legacy fallback'); // sets both, but…
    // Restore the empty authors_note to test fallback path on subsequent read.
    state.metadata['authors_note'] = { content: '', depth: 4, role: 'system', position: 0 };
    expect(await rt.getAuthorNote()).toBe('legacy fallback');
  });
});

describe('Lua character data APIs use the host state', () => {
  test('getDescription and setDescription read and update the active character', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const state: MockState = {
      metadata: {},
      characterDescription: 'host description',
      characterUpdates: updates,
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );

    await rt.runLua(`
      function onRun()
        setChatVar("trigger", "description_result", getDescription("trigger"))
        setDescription("trigger", "updated description")
      end
    `);
    await rt.flush();

    expect(rt.getVar('description_result')).toBe('host description');
    expect(updates).toEqual([{ description: 'updated description' }]);
  });

  test('name and first-message APIs read and update the active character', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const state: MockState = {
      metadata: {},
      characterName: 'Host Name',
      characterFirstMessage: 'Host greeting',
      characterUpdates: updates,
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );

    await rt.runLua(`
      function onRun()
        setChatVar("trigger", "name_result", getName("trigger"))
        setChatVar("trigger", "greeting_result", getCharacterFirstMessage("trigger"))
        setName("trigger", "Updated Name")
        setCharacterFirstMessage("trigger", "Updated greeting")
      end
    `);

    expect(rt.getVar('name_result')).toBe('Host Name');
    expect(rt.getVar('greeting_result')).toBe('Host greeting');
    expect(updates).toEqual([
      { name: 'Updated Name' },
      { firstMessage: 'Updated greeting' },
    ]);
  });

  test('getPersonaDescription parses host persona text like Risu', async () => {
    const state: MockState = {
      metadata: {},
      personaDescription: 'Hello {{user}}',
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      { ...dispatchData, userName: 'Alice' },
      makeMockScriptNS(),
      { resolveTemplate: async (text) => text.replace('{{user}}', 'Alice') },
    );

    await rt.runLua(`
      function onRun()
        setChatVar("trigger", "persona_result", getPersonaDescription("trigger"))
      end
    `);
    expect(rt.getVar('persona_result')).toBe('Hello Alice');
  });

  test('getAuthorsNote reads chat metadata rather than the legacy-only variable', async () => {
    const state: MockState = {
      metadata: {
        authors_note: { content: 'host author note', depth: 4, role: 'system', position: 0 },
      },
    };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(state),
      dispatchData,
      makeMockScriptNS(),
    );

    await rt.runLua(`
      function onRun()
        setChatVar("trigger", "note_result", getAuthorsNote("trigger"))
      end
    `);
    expect(rt.getVar('note_result')).toBe('host author note');
  });
});
