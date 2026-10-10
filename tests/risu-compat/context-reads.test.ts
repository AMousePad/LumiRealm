import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Diff tests for the context-reads batch. We invoke each handler by name
// via the registry and assert the Risu-cited behavior.

function call(name: string, ctx = makeMockContext(), args: string[] = [], raw = ""): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, raw);
}

describe("exampledialogue / mainprompt / jb / …", () => {
  test("each returns the corresponding character field verbatim", () => {
    const ctx = makeMockContext({
      character: {
        exampleDialogue: "EX",
        mainPrompt: "MP",
        jailbreakPrompt: "JB",
        globalNote: "GN",
        authorsNote: "AN",
      },
    });
    expect(call("exampledialogue", ctx)).toBe("EX");
    expect(call("mainprompt", ctx)).toBe("MP");
    expect(call("jb", ctx)).toBe("JB");
    expect(call("globalnote", ctx)).toBe("GN");
    expect(call("authornote", ctx)).toBe("AN");
  });
});

describe("model / axmodel / role / isfirstmsg", () => {
  test("model / axmodel passthrough", () => {
    const ctx = makeMockContext({ aiModel: "gpt-4", axModel: "text-embedding-3-small" });
    expect(call("model", ctx)).toBe("gpt-4");
    expect(call("axmodel", ctx)).toBe("text-embedding-3-small");
  });
  test("role returns 'null' when no role in context", () => {
    expect(call("role", makeMockContext({ role: null }))).toBe("null");
  });
  test("role returns mapped Risu role when ctx.role is set (assistant → char)", () => {
    expect(call("role", makeMockContext({ role: "assistant" }))).toBe("char");
  });
  test("role returns 'user' when ctx.role is 'user'", () => {
    expect(call("role", makeMockContext({ role: "user" }))).toBe("user");
  });
  test("prompt/cbs no-message context still honors its explicit prompt role", () => {
    expect(call("role", makeMockContext({
      role: "assistant",
      cbsContext: true,
    }))).toBe("char");
    expect(call("role", makeMockContext({
      role: null,
      cbsContext: true,
    }))).toBe("null");
  });
  test("ctx.role takes precedence over isFirstMessage fallback", () => {
    expect(call("role", makeMockContext({ isFirstMessage: true, role: "user" }))).toBe("user");
  });
  test("role falls back to 'char' on first message when ctx.role is null", () => {
    expect(call("role", makeMockContext({ isFirstMessage: true, role: null }))).toBe("char");
  });
  test("isfirstmsg returns '1' or '0' (chat-wide fallback when no per-message index)", () => {
    expect(call("isfirstmsg", makeMockContext({ isFirstMessage: true }))).toBe("1");
    expect(call("isfirstmsg", makeMockContext({ isFirstMessage: false }))).toBe("0");
  });
  test("isfirstmsg uses currentMessageIndex === -1 (greeting render) when set", () => {
    expect(call("isfirstmsg", makeMockContext({ currentMessageIndex: -1 }))).toBe("1");
    expect(call("isfirstmsg", makeMockContext({ currentMessageIndex: 0 }))).toBe("0");
    expect(call("isfirstmsg", makeMockContext({ currentMessageIndex: 5 }))).toBe("0");
  });
  test("prompt/cbs no-message context has no firstmsg condition", () => {
    expect(call("isfirstmsg", makeMockContext({
      currentMessageIndex: -1,
      cbsContext: true,
    }))).toBe("0");
  });
  test("currentMessageIndex takes precedence over chat-wide isFirstMessage proxy", () => {
    expect(call("isfirstmsg", makeMockContext({ currentMessageIndex: 5, isFirstMessage: true }))).toBe("0");
    expect(call("isfirstmsg", makeMockContext({ currentMessageIndex: -1, isFirstMessage: false }))).toBe("1");
  });
});

describe("time macros", () => {
  test("unixtime seconds since epoch", () => {
    const ctx = makeMockContext({ now: 1_700_000_000_000 });
    expect(call("unixtime", ctx)).toBe("1700000000");
  });
  test("time is H:M:S unpadded", () => {
    const ctx = makeMockContext({ now: new Date(2024, 5, 1, 3, 5, 9).getTime() });
    // Local time depends on host TZ; just check format shape.
    const out = call("time", ctx);
    expect(out).toMatch(/^\d{1,2}:\d{1,2}:\d{1,2}$/);
  });
  test("isotime matches UTC H:M:S", () => {
    // 2024-06-01T12:34:56Z
    const ctx = makeMockContext({ now: Date.UTC(2024, 5, 1, 12, 34, 56) });
    expect(call("isotime", ctx)).toBe("12:34:56");
  });
  test("isodate returns unpadded UTC YYYY-M-D", () => {
    const ctx = makeMockContext({ now: Date.UTC(2024, 5, 9, 0, 0, 0) });
    // Month 5 (JS) = June = 6. Day = 9. Matches Risu's direct +1/non-pad.
    expect(call("isodate", ctx)).toBe("2024-6-9");
  });
});

describe("message-time macros", () => {
  test("messagetime returns bracketed error when no currentMessageIndex", () => {
    expect(call("messagetime", makeMockContext({ currentMessageIndex: null }))).toBe("[Cannot get time]");
    expect(call("messagedate", makeMockContext({ currentMessageIndex: null }))).toBe("[Cannot get time]");
  });
  test("messageunixtimearray", () => {
    const ctx = makeMockContext({ messages: [
      { role: "user", content: "a", createdAt: 100 },
      { role: "assistant", content: "b", createdAt: 200 },
    ]});
    expect(call("messageunixtimearray", ctx)).toBe('["100","200"]');
  });
  test("idleduration HH:MM:SS", () => {
    // Risu treats time=0 as "missing" via falsy check, so use createdAt: 1
    // for a proper duration calc.
    const ctx = makeMockContext({
      now: 3_600_001,
      messages: [{ role: "user", content: "a", createdAt: 1 }],
    });
    expect(call("idleduration", ctx)).toBe("1:00:00");
  });
  test("idleduration '00:00:00' when no messages", () => {
    expect(call("idleduration", makeMockContext({ messages: [] }))).toBe("00:00:00");
  });
  test("messageidleduration between two user messages", () => {
    const ctx = makeMockContext({
      currentMessageIndex: 2,
      messages: [
        { role: "user", content: "a", createdAt: 1000 },
        { role: "assistant", content: "b", createdAt: 5000 },
        { role: "user", content: "c", createdAt: 11000 }, // index 2
      ],
    });
    // (11000 - 1000) ms = 10s
    expect(call("messageidleduration", ctx)).toBe("0:00:10");
  });
});

describe("literals", () => {
  test("br returns newline", () => {
    expect(call("br", makeMockContext())).toBe("\n");
  });
  test("blank returns empty", () => {
    expect(call("blank", makeMockContext())).toBe("");
  });
});
