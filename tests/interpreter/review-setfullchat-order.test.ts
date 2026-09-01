import { expect, test } from "bun:test";
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from "../../src/interpreter/runtime.js";
import { execute as luaExecute } from "../../src/interpreter/lua-bridge.js";
import type { DispatchData, HostApi, HostMessage, ScriptNS } from "../../src/interpreter/host.js";

function scriptNs(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === "risu-compat") return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === "risu-compat-lua") return { execute: luaExecute };
      throw new Error(name);
    },
  } as unknown as ScriptNS;
}

test("role replacement keeps the host row order aligned with the runtime cache", async () => {
  const rows: HostMessage[] = [
    { id: "first", role: "user", content: "replace role" },
    { id: "second", role: "user", content: "keep second" },
  ];
  let nextId = 0;
  const api = {
    chat: {
      getMessages: async () => rows.map((row) => ({ ...row })),
      sendMessage: async (content: string, opts?: { role?: string }) => {
        const id = `new-${++nextId}`;
        rows.push({ id, role: opts?.role ?? "user", content });
        return { id };
      },
      editMessage: async (id: string, content: string) => {
        const row = rows.find((item) => item.id === id);
        if (row) Object.assign(row, { content });
      },
      deleteMessage: async (id: string) => {
        const index = rows.findIndex((item) => item.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
      getMetadata: async () => undefined,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
  } as unknown as HostApi;
  const data: DispatchData = { characterId: "c", chatId: "chat" };
  const runtime = await makeRisuTriggerRuntime(api, data, scriptNs());

  await runtime.runLua(`
    setFullChat("trigger", {
      { role = "char", data = "replacement" },
      { role = "user", data = "keep second" }
    })
  `);
  await runtime.flush();

  expect(rows.map(({ role, content }) => ({ role, content }))).toEqual([
    { role: "assistant", content: "replacement" },
    { role: "user", content: "keep second" },
  ]);
});

test("successive setFullChat edits cannot complete out of order", async () => {
  const rows: HostMessage[] = [
    { id: "user", role: "user", content: "keep" },
    { id: "assistant", role: "assistant", content: "initial" },
  ];
  let editCount = 0;
  const api = {
    chat: {
      getMessages: async () => rows.map((row) => ({ ...row })),
      sendMessage: async () => ({ id: "unused" }),
      editMessage: async (_id: string, content: string) => {
        editCount++;
        if (editCount === 1) await new Promise((resolve) => setTimeout(resolve, 25));
        Object.assign(rows[1]!, { content });
      },
      deleteMessage: async () => {},
      getMetadata: async () => undefined,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
  } as unknown as HostApi;
  const data: DispatchData = { characterId: "c", chatId: "chat" };
  const runtime = await makeRisuTriggerRuntime(api, data, scriptNs());

  await runtime.runLua(`
    setFullChat("trigger", {
      { role = "user", data = "keep" },
      { role = "char", data = "first edit" }
    })
    setFullChat("trigger", {
      { role = "user", data = "keep" },
      { role = "char", data = "second edit" }
    })
  `);
  await runtime.flush();

  expect(rows[1]!.content).toBe("second edit");
});
