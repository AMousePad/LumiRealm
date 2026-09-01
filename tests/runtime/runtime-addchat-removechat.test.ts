import { describe, test, expect } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import type { HostApi, ScriptNS, DispatchData, HostMessage } from '../../src/interpreter/host.js';

// Risu's addChat/removeChat mutate the in-memory chat.message array and
// commit the net result at trigger end, so the show-then-clear idiom
// (addChat temp -> work -> removeChat(-1)) nets to no persisted message.
// Our addChat persists immediately via sendMessage, so removeChat must be
// able to delete the row it created (real Lumi id, negative index resolved).

interface MockChat {
  sends: { content: string; role: string; id: string }[];
  deletes: string[];
  edits?: { id: string; content: string }[];
  metadata?: Map<string, unknown>;
}

function makeMockHostApi(initial: HostMessage[], chat: MockChat): HostApi {
  let n = 0;
  return {
    chat: {
      getMessages: async () => initial,
      sendMessage: async (content: string, opts?: { role?: string }) => {
        const id = `real-${++n}`;
        chat.sends.push({ content, role: opts?.role ?? 'user', id });
        return { id };
      },
      editMessage: async (id: string, content: string) => { (chat.edits ??= []).push({ id, content }); },
      deleteMessage: async (id: string) => { chat.deletes.push(id); },
      getMetadata: async (key: string) => chat.metadata?.get(key),
      setMetadata: async (key: string, value: unknown) => { chat.metadata?.set(key, value); },
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
  } as unknown as HostApi;
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

describe('runtime addChat + removeChat — Risu show-then-clear parity', () => {
  test('addChat then removeChat(-1) deletes the real Lumi row it created', async () => {
    const chat: MockChat = { sends: [], deletes: [] };
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi([], chat),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.runLua('addChat("t", "char", "TEMP")\nremoveChat("t", -1)');
    await rt.flush();
    expect(chat.sends.length).toBe(1);
    expect(chat.sends[0]!.content).toBe('TEMP');
    // The created row's real id must be the one deleted (no orphan persists).
    expect(chat.deletes).toEqual([chat.sends[0]!.id]);
  });

  test('removeChat clamps like Risu chat.message.splice: -2 on a 1-msg chat removes msg 0', async () => {
    const chat: MockChat = { sends: [], deletes: [] };
    const initial: HostMessage[] = [{ id: 'only', role: 'user', content: 'x' }];
    const rt = await makeRisuTriggerRuntime(makeMockHostApi(initial, chat), dispatchData, makeMockScriptNS());
    await rt.runLua('removeChat("t", -2)');
    await rt.flush();
    // JS splice(-2,1) on len 1 → start=max(1-2,0)=0 → removes the only message.
    expect(chat.deletes).toEqual(['only']);
  });

  test('removeChat out-of-range positive is a no-op (Risu splice past end)', async () => {
    const chat: MockChat = { sends: [], deletes: [] };
    const initial: HostMessage[] = [{ id: 'a', role: 'user', content: 'x' }];
    const rt = await makeRisuTriggerRuntime(makeMockHostApi(initial, chat), dispatchData, makeMockScriptNS());
    await rt.runLua('removeChat("t", 5)');
    await rt.flush();
    expect(chat.deletes).toEqual([]);
  });

  test('removeChat(NaN) is a defensive no-op (does NOT delete message 0)', async () => {
    const chat: MockChat = { sends: [], deletes: [] };
    const initial: HostMessage[] = [{ id: 'keep', role: 'user', content: 'x' }];
    const rt = await makeRisuTriggerRuntime(makeMockHostApi(initial, chat), dispatchData, makeMockScriptNS());
    await rt.runLua('removeChat("t", "not-a-number")');
    await rt.flush();
    expect(chat.deletes).toEqual([]);
  });

  test('addChat → setChat(-1) → removeChat(-1): created row still gets deleted (no leak)', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const rt = await makeRisuTriggerRuntime(makeMockHostApi([], chat), dispatchData, makeMockScriptNS());
    await rt.runLua('addChat("t","char","TEMP")\nsetChat("t",-1,"EDITED")\nremoveChat("t",-1)');
    await rt.flush();
    expect(chat.sends.length).toBe(1);
    const id = chat.sends[0]!.id;
    // setChat before the send resolved must not strand the row: removeChat
    // still deletes the real id once it lands.
    expect(chat.deletes).toEqual([id]);
  });

  test('addChat → (await) → setChat(-1) keep: row created then edited with the new content', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const rt = await makeRisuTriggerRuntime(makeMockHostApi([], chat), dispatchData, makeMockScriptNS());
    await rt.runLua('addChat("t","char","LOADING")\nsetChat("t",-1,"FINAL")');
    await rt.flush();
    expect(chat.sends.length).toBe(1);
    const id = chat.sends[0]!.id;
    expect(chat.deletes).toEqual([]);
    expect(chat.edits).toEqual([{ id, content: 'FINAL' }]);
  });

  test('removeChat(-1) on a pre-existing message deletes by its real id', async () => {
    const chat: MockChat = { sends: [], deletes: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hi' },
      { id: 'm-asst', role: 'assistant', content: 'reply' },
    ];
    const rt = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );
    await rt.runLua('removeChat("t", -1)');
    await rt.flush();
    // Negative index resolves from the end: -1 is the last message 'm-asst'.
    expect(chat.deletes).toEqual(['m-asst']);
  });
});

describe('runtime setFullChat persistence', () => {
  test('setChatRole persists the changed role and preserves the following rows', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hello' },
      { id: 'm-asst', role: 'assistant', content: 'reply' },
    ];
    const runtime = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );

    await runtime.runLua('setChatRole("trigger", 0, "char")');
    await runtime.flush();

    expect(chat.deletes).toEqual(['m-user', 'm-asst']);
    expect(chat.sends).toEqual([
      { id: 'real-1', role: 'assistant', content: 'hello' },
      { id: 'real-2', role: 'assistant', content: 'reply' },
    ]);
  });

  test('insertChat persists the inserted row at the requested position', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hello' },
      { id: 'm-asst', role: 'assistant', content: 'reply' },
    ];
    const runtime = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );

    await runtime.runLua('insertChat("trigger", 1, "user", "inserted")');
    await runtime.flush();

    expect(chat.deletes).toEqual(['m-asst']);
    expect(chat.sends).toEqual([
      { id: 'real-1', role: 'user', content: 'inserted' },
      { id: 'real-2', role: 'assistant', content: 'reply' },
    ]);
    expect(runtime.getMessageCount()).toBe(3);
    expect(runtime.getMessageAtIndex(1)).toBe('inserted');
  });

  test('same-length content mutation edits the existing real message id', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hello' },
      { id: 'm-asst', role: 'assistant', content: 'before' },
    ];
    const runtime = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );

    await runtime.runLua(`
      local full = getFullChat("trigger")
      full[#full].data = "after"
      setFullChat("trigger", full)
    `);
    await runtime.flush();

    expect(chat.edits).toEqual([{ id: 'm-asst', content: 'after' }]);
    expect(chat.deletes).toEqual([]);
    expect(chat.sends).toEqual([]);
    expect(runtime.getLastMessage()).toBe('after');
  });

  test('appended rows are sent and receive a real id usable by a later removal', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hello' },
    ];
    const runtime = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );

    await runtime.runLua(`
      local full = getFullChat("trigger")
      table.insert(full, { role = "char", data = "new reply" })
      setFullChat("trigger", full)
    `);
    await runtime.flush();

    expect(chat.sends).toEqual([
      { id: 'real-1', role: 'assistant', content: 'new reply' },
    ]);
    expect(chat.edits).toEqual([]);
    expect(chat.deletes).toEqual([]);
    expect(runtime.getMessageCount()).toBe(2);

    await runtime.runLua('removeChat("trigger", -1)');
    await runtime.flush();
    expect(chat.deletes).toEqual(['real-1']);
  });

  test('removed rows delete their existing real message ids', async () => {
    const chat: MockChat = { sends: [], deletes: [], edits: [] };
    const initial: HostMessage[] = [
      { id: 'm-user', role: 'user', content: 'hello' },
      { id: 'm-asst', role: 'assistant', content: 'remove me' },
    ];
    const runtime = await makeRisuTriggerRuntime(
      makeMockHostApi(initial, chat),
      dispatchData,
      makeMockScriptNS(),
    );

    await runtime.runLua(`
      local full = getFullChat("trigger")
      table.remove(full, #full)
      setFullChat("trigger", full)
    `);
    await runtime.flush();

    expect(chat.deletes).toEqual(['m-asst']);
    expect(chat.edits).toEqual([]);
    expect(chat.sends).toEqual([]);
    expect(runtime.getMessageCount()).toBe(1);
  });

});
