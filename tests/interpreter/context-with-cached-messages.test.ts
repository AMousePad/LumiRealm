import { describe, test, expect } from "bun:test";
import {
  evaluate,
  buildEvaluatorContext,
} from "../../src/interpreter/evaluator/index.js";

const fullMsgs = [
  { role: "user" as const, content: "u0", createdAt: 1 },
  { role: "assistant" as const, content: "a0", createdAt: 2 },
  { role: "user" as const, content: "u1", createdAt: 3 },
  { role: "assistant" as const, content: "a1", createdAt: 4 },
];

function ctxWith(opts: {
  messages?: readonly { role: "user" | "assistant" | "system"; content: string; createdAt: number }[];
  currentMessageIndex?: number;
  lastUser?: string;
  lastChar?: string;
} = {}) {
  return buildEvaluatorContext({
    chatId: "test-chat",
    userName: "Alice",
    charName: "Bob",
    character: { description: "" },
    chat: {
      messageCount: 4,
      lastUserMessage: opts.lastUser ?? "u1",
      lastCharMessage: opts.lastChar ?? "a1",
      ...(opts.messages !== undefined ? { messages: opts.messages } : {}),
    },
    variables: {},
    ...(opts.currentMessageIndex !== undefined ? { currentMessageIndexOverride: opts.currentMessageIndex } : {}),
    commit: false,
  });
}

describe("buildEvaluatorContext — chat.messages override", () => {
  test("when chat.messages is omitted, falls back to synthesized lastUser+lastChar", () => {
    const ctx = ctxWith({ lastUser: "u-only", lastChar: "a-only" });
    expect(ctx.messages.all().map((m) => m.content)).toEqual(["u-only", "a-only"]);
  });

  test("when chat.messages is provided, exposes the full array verbatim", () => {
    const ctx = ctxWith({ messages: fullMsgs });
    expect(ctx.messages.all()).toEqual(fullMsgs);
  });

  test("messages.lastOf walks the full array", () => {
    const ctx = ctxWith({ messages: fullMsgs });
    expect(ctx.messages.lastOf("user")?.content).toBe("u1");
    expect(ctx.messages.lastOf("assistant")?.content).toBe("a1");
  });

  test("messages.count uses cached length, not synthesized fallback", () => {
    const ctx = ctxWith({ messages: fullMsgs });
    expect(ctx.messages.count()).toBe(4);
    expect(ctx.messages.count("user")).toBe(2);
    expect(ctx.messages.count("assistant")).toBe(2);
  });

  test("previoususerchat walks back through full history when cached", () => {
    const ctx = ctxWith({ messages: fullMsgs, currentMessageIndex: 3 });
    expect(evaluate("{{previoususerchat}}", ctx)).toBe("u1");
  });

  test("previouscharchat walks back through full history when cached", () => {
    const ctx = ctxWith({ messages: fullMsgs, currentMessageIndex: 3 });
    expect(evaluate("{{previouscharchat}}", ctx)).toBe("a0");
  });

  test("previoususerchat returns '' on greeting render (currentMessageIndex=-1)", () => {
    const ctx = ctxWith({ messages: fullMsgs, currentMessageIndex: -1 });
    expect(evaluate("{{previoususerchat}}", ctx)).toBe("");
  });

  test("previouschatlog::N indexes into Risu-frame full array", () => {
    const ctx = ctxWith({ messages: fullMsgs });
    expect(evaluate("{{previouschatlog::0}}", ctx)).toBe("u0");
    expect(evaluate("{{previouschatlog::2}}", ctx)).toBe("u1");
    expect(evaluate("{{previouschatlog::99}}", ctx)).toBe("Out of range");
  });

  test("isfirstmsg=1 on greeting render even with non-empty cached messages", () => {
    const ctx = ctxWith({ messages: fullMsgs, currentMessageIndex: -1 });
    expect(evaluate("{{isfirstmsg}}", ctx)).toBe("1");
  });

  test("isfirstmsg=0 on chat-message render (any currentMessageIndex >= 0)", () => {
    const ctx = ctxWith({ messages: fullMsgs, currentMessageIndex: 2 });
    expect(evaluate("{{isfirstmsg}}", ctx)).toBe("0");
  });
});
