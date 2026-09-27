import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import { runPipeline, type RunPipelineInput } from "../../src/interpreter/evaluator/pipeline.js";
import "../../src/risu-compat/handlers/index.js";

// Deep chat-context macros. Risu source: cbs.ts referenced inline.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("lorebook (cbs.ts:317)", () => {
  test("JSON array of stringified entries", () => {
    const ctx = makeMockContext({
      lorebook: [
        { key: "a", content: "A" },
        { key: "b", content: "B" },
      ],
    });
    const out = call("lorebook", [], ctx);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(JSON.parse(parsed[0])).toEqual({ key: "a", content: "A" });
  });
  test("empty lorebook → []", () => {
    expect(call("lorebook")).toBe("[]");
  });
});

describe("userhistory / charhistory (cbs.ts:336, 354)", () => {
  const ctx = makeMockContext({
    messages: [
      { role: "user", content: "hi", createdAt: 100 },
      { role: "assistant", content: "hello", createdAt: 200 },
      { role: "user", content: "how", createdAt: 300 },
      { role: "system", content: "s", createdAt: 150 },
    ],
  });
  test("userhistory filters user messages", () => {
    const out = JSON.parse(call("userhistory", [], ctx));
    expect(out).toHaveLength(2);
    const first = JSON.parse(out[0]);
    expect(first.role).toBe("user");
    expect(first.data).toBe("hi");
    expect(first.time).toBe(100);
  });
  test("charhistory filters assistants, role normalized to 'char'", () => {
    const out = JSON.parse(call("charhistory", [], ctx));
    expect(out).toHaveLength(1);
    const first = JSON.parse(out[0]);
    expect(first.role).toBe("char"); // Risu's wire format
    expect(first.data).toBe("hello");
  });
});

describe("history (cbs.ts:1511)", () => {
  test("no args → full history prepended with first-greeting", () => {
    const ctx = makeMockContext({
      messages: [{ role: "user", content: "u", createdAt: 1 }],
      character: { firstMessage: "GREETING" } as any,
    });
    const out = JSON.parse(call("history", [], ctx));
    expect(out).toHaveLength(2);
    const fm = JSON.parse(out[0]);
    expect(fm).toEqual({ role: "char", data: "GREETING" });
    expect(JSON.parse(out[1])).toEqual({ role: "user", data: "u", time: 1 });
  });
  test("'role' arg → array of 'role: data' strings, no first-greeting", () => {
    const ctx = makeMockContext({
      messages: [
        { role: "user", content: "u", createdAt: 1 },
        { role: "assistant", content: "a", createdAt: 2 },
      ],
    });
    const out = JSON.parse(call("history", ["role"], ctx));
    expect(out).toEqual(["user: u", "char: a"]);
  });
  test("selected alternate greeting used when fmIndex != -1", () => {
    const ctx = makeMockContext({
      messages: [],
      character: {
        firstMessage: "FM0",
        alternateGreetings: ["FM1", "FM2"],
        selectedAlternateGreetingIndex: 1,
      } as any,
    });
    const out = JSON.parse(call("history", [], ctx));
    expect(JSON.parse(out[0]).data).toBe("FM2");
  });
  test("no-arg history recursively evaluates greeting and message data", () => {
    const base = makeMockContext({
      messages: [{ role: "user", content: "message {{value}}", createdAt: 1 }],
      character: { firstMessage: "greeting {{value}}" } as any,
    });
    const ctx = {
      ...base,
      evaluate: (text: string) => text.replaceAll("{{value}}", "resolved"),
    };
    const out = (JSON.parse(call("history", [], ctx)) as string[])
      .map((item) => JSON.parse(item));
    expect(out.map((item) => item.data)).toEqual([
      "greeting resolved",
      "message resolved",
    ]);
  });
});

describe("previouschatlog (cbs.ts:1146)", () => {
  const ctx = makeMockContext({
    messages: [
      { role: "user", content: "first", createdAt: 1 },
      { role: "assistant", content: "second", createdAt: 2 },
    ],
  });
  test("indexed lookup", () => {
    expect(call("previouschatlog", ["0"], ctx)).toBe("first");
    expect(call("previouschatlog", ["1"], ctx)).toBe("second");
  });
  test("out of range", () => {
    expect(call("previouschatlog", ["99"], ctx)).toBe("Out of range");
  });
});

describe("previouscharchat / previoususerchat (cbs.ts:194, 213)", () => {
  const msgs = [
    { role: "user" as const, content: "u0", createdAt: 1 },
    { role: "assistant" as const, content: "a0", createdAt: 2 },
    { role: "user" as const, content: "u1", createdAt: 3 },
    { role: "assistant" as const, content: "a1", createdAt: 4 }, // currentIndex=3
  ];
  test("previouscharchat walks back from current index", () => {
    const ctx = makeMockContext({ messages: msgs, currentMessageIndex: 3 });
    expect(call("previouscharchat", [], ctx)).toBe("a0");
  });
  test("previouschar fallback → first-greeting when no assistant messages", () => {
    const ctx = makeMockContext({
      messages: [{ role: "user", content: "u", createdAt: 1 }],
      currentMessageIndex: 0,
      character: { firstMessage: "FG" } as any,
    });
    expect(call("previouscharchat", [], ctx)).toBe("FG");
  });
  test("previoususerchat requires currentMessageIndex", () => {
    expect(call("previoususerchat", [], makeMockContext({ currentMessageIndex: null }))).toBe("");
  });
  test("previoususerchat walks back to last user", () => {
    const ctx = makeMockContext({ messages: msgs, currentMessageIndex: 3 });
    expect(call("previoususerchat", [], ctx)).toBe("u1");
  });
});

describe("lastmessage / lastmessageid (cbs.ts:722, 737)", () => {
  test("last message content", () => {
    const ctx = makeMockContext({
      messages: [
        { role: "user", content: "a", createdAt: 1 },
        { role: "assistant", content: "b", createdAt: 2 },
      ],
    });
    expect(call("lastmessage", [], ctx)).toBe("b");
    // Mock is in Risu's greeting-excluded frame; 2 msgs → lastmessageid = 1.
    expect(call("lastmessageid", [], ctx)).toBe("1");
  });
  test("empty chat", () => {
    expect(call("lastmessage")).toBe("");
    // Risu cbs.ts:746 returns `(chat.message.length - 1).toString()`
    // unconditionally when a character is selected; empty chat → "-1".
    // (The `""` fallback at :742-744 is only the no-character case, which
    // our runtime guards elsewhere.)
    expect(call("lastmessageid")).toBe("-1");
  });
});

describe("previous-message aliases match Risu registerCBS", () => {
  const messages = [
    { role: "user" as const, content: "u0", createdAt: 1 },
    { role: "assistant" as const, content: "a0", createdAt: 2 },
    { role: "user" as const, content: "u1", createdAt: 3 },
    { role: "assistant" as const, content: "a1", createdAt: 4 },
  ];

  function parse(overrides: Partial<RunPipelineInput> = {}): string {
    return runPipeline({
      template: "{{previouscharchat}}|{{lastcharmessage}}|{{previoususerchat}}|{{lastusermessage}}",
      phase: "display", chatId: "", userName: "User", charName: "Character",
      character: { firstMessage: "Greeting" },
      chat: { messageCount: messages.length + 1, messages }, variables: {},
      ...overrides,
    });
  }

  // Risu cbs.ts:195-233 uses chatID, independent of current role or display mode.
  for (const [name, index, character, user] of [
    ["default index", undefined, "a1", ""],
    ["greeting index", -1, "a1", ""],
    ["first stored message", 0, "Greeting", "Greeting"],
    ["second stored message", 1, "Greeting", "u0"],
    ["third stored message", 2, "a0", "u0"],
    ["fourth stored message", 3, "a0", "u1"],
    ["position after history", 4, "a1", "u1"],
    ["negative explicit index", -2, "Greeting", "Greeting"],
    ["NaN explicit index", NaN, "Greeting", "Greeting"],
  ] as const) {
    test(name, () => {
      expect(parse(index === undefined ? {} : { currentMessageIndexOverride: index }))
        .toBe([character, character, user, user].join("|"));
    });
  }

  test("Lua cbs uses its default index despite host last-message metadata", () => {
    expect(parse({ cbsContext: true, currentMessageIndexOverride: -1,
      chat: { messages, lastMessageId: 4 } })).toBe("a1|a1||");
  });

  for (const index of [-1, 0]) {
    test(`empty chat at index ${index} keeps the greeting fallback`, () => {
      expect(parse({ chat: { messages: [] }, currentMessageIndexOverride: index }))
        .toBe(index === -1 ? "Greeting|Greeting||" : "Greeting|Greeting|Greeting|Greeting");
    });
  }

  test("a missing previous role falls back to the selected alternate greeting", () => {
    const character = { firstMessage: "Greeting", alternateGreetings: ["Alternate"],
      selectedAlternateGreetingIndex: 0 };
    expect(parse({ character, currentMessageIndexOverride: 1,
      chat: { messages: messages.filter(m => m.role === "user") } }))
      .toBe("Alternate|Alternate|u0|u0");
    expect(parse({ character, currentMessageIndexOverride: 1,
      chat: { messages: messages.filter(m => m.role === "assistant") } }))
      .toBe("a0|a0|Alternate|Alternate");
  });

  for (const role of ["user", "assistant", "system"] as const) {
    test(`current role ${role} does not change the search`, () => {
      expect(parse({ currentMessageIndexOverride: 3, currentMessageRoleOverride: role }))
        .toBe("a0|a0|u1|u1");
    });
  }

  test("stored system messages are skipped", () => {
    expect(parse({ currentMessageIndexOverride: 2, chat: { messages: [messages[0]!,
      { role: "system", content: "System", createdAt: 2 }, messages[1]!] } }))
      .toBe("Greeting|Greeting|u0|u0");
  });

  test("aliases normalize names and ignore extra arguments", () => {
    expect(parse({ currentMessageIndexOverride: 3,
      template: "{{LAST_CHAR-MESSAGE::ignored}}|{{LAST_USER-MESSAGE::ignored::second}}" }))
      .toBe("a0|u1");
  });

  for (const index of [5, 1.5, Infinity]) {
    test(`invalid history access at ${index} preserves the macro`, () => {
      const template = "{{previouscharchat}}|{{lastcharmessage}}|{{previoususerchat}}|{{lastusermessage}}";
      expect(parse({ template, currentMessageIndexOverride: index })).toBe(template);
    });
  }
});

describe("jbtoggled / maxcontext (cbs.ts:702, 712)", () => {
  test("jbtoggled '1' / '0'", () => {
    expect(call("jbtoggled", [], makeMockContext({ jailbreakToggle: true }))).toBe("1");
    expect(call("jbtoggled", [], makeMockContext({ jailbreakToggle: false }))).toBe("0");
  });
  test("maxcontext reflects ctx", () => {
    expect(call("maxcontext", [], makeMockContext({ maxContext: 8192 }))).toBe("8192");
  });
});

describe("messagecount", () => {
  test("counts messages", () => {
    const ctx = makeMockContext({
      messages: [
        { role: "user", content: "a", createdAt: 1 },
        { role: "assistant", content: "b", createdAt: 2 },
      ],
    });
    expect(call("messagecount", [], ctx)).toBe("2");
    expect(call("messagecount")).toBe("0");
  });
});
