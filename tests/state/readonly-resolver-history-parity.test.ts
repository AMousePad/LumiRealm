import { describe, expect, test } from "bun:test";
import { createReadonlyResolver } from "../../src/state/readonly-resolver.js";
import "../../src/risu-compat/handlers/index.js";

const CHAT = "chat-history";
const CHARACTER = "character-history";
const USER = "user-history";

function makeResolver() {
  const messages = [
    {
      id: "greeting",
      role: "assistant",
      content: "Stored greeting",
      send_date: 10,
      created_at: 10,
      name: "Alice",
    },
    {
      id: "u0",
      role: "user",
      content: "first user",
      send_date: 20,
      created_at: 20,
      name: "Bob",
    },
    {
      id: "a0",
      role: "assistant",
      content: "first answer",
      send_date: 30,
      created_at: 30,
      name: "Alice",
    },
    {
      id: "u1",
      role: "user",
      content: "second user",
      send_date: 40,
      created_at: 40,
      name: "Bob",
    },
    {
      id: "staged",
      role: "assistant",
      content: "",
      send_date: 50,
      created_at: 50,
      name: "Alice",
    },
  ];

  (globalThis as Record<string, unknown>).spindle = {
    chat: {
      getMessages: async () => messages,
    },
    chats: {
      get: async () => ({
        id: CHAT,
        metadata: { activeGreetingIndex: 2 },
      }),
    },
    characters: {
      get: async () => ({
        id: CHARACTER,
        name: "Alice",
        first_mes: "Canonical greeting",
        alternate_greetings: ["Alternate one", "Alternate two"],
      }),
    },
    personas: {
      getActive: async () => ({ name: "Bob" }),
    },
  };

  return createReadonlyResolver({
    activeCardByChat: new Map(),
    getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
    modulesByNamespaceFromCard: () => null,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    errMsg: String,
  });
}

describe("readonly resolver Risu chat view", () => {
  test("history macros receive the complete greeting-excluded chat", async () => {
    const resolver = makeResolver();

    expect(await resolver.resolveInWorker(
      "{{messagecount}}|{{lastmessageid}}|{{lastmessage}}|{{previouschatlog::0}}|{{previouschatlog::2}}|{{firstmsgindex}}",
      CHAT,
      CHARACTER,
      USER,
    )).toBe("3|2|second user|first user|second user|1");

    const historyRaw = await resolver.resolveInWorker(
      "{{history}}",
      CHAT,
      CHARACTER,
      USER,
    );
    const history = (JSON.parse(historyRaw) as string[]).map((item) => JSON.parse(item));
    expect(history).toEqual([
      { role: "char", data: "Stored greeting", time: 0 },
      { role: "user", data: "first user", time: 20, speaker: "Bob" },
      { role: "char", data: "first answer", time: 30, speaker: "Alice" },
      { role: "user", data: "second user", time: 40, speaker: "Bob" },
    ]);
  });
});
