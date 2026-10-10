import { describe, test, expect } from "bun:test";
import regexRunner, {
  runRegexRequest,
  type RegexRunnerRequest,
  type RegexRunnerReply,
} from "../../src/regex-runner.js";
import { applyPromptRegexToArray } from "../../src/interceptors/prompt-regex-apply.js";
import type { RegexCoreScript } from "../../src/display/regex-core.js";
import type { LlmMessage } from "../../src/adapters/spindle-extras.js";
import type { PrebuiltPipelineInput } from "../../src/interceptors/prompt-regex-apply.js";

function script(overrides: Partial<RegexCoreScript>): RegexCoreScript {
  return {
    find_regex: "",
    replace_string: "",
    flags: "g",
    substitute_macros: "none",
    placement: ["user_input", "ai_output"],
    target: "prompt",
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    ...overrides,
  };
}

const PREBUILT = {} as unknown as PrebuiltPipelineInput;

function msg(role: LlmMessage["role"], content: string): LlmMessage {
  return { role, content };
}

describe("runRegexRequest — parity with applyPromptRegexToArray", () => {
  test("produces the same transformed array as the inline pass", async () => {
    const scripts = [
      script({ find_regex: "X", replace_string: "Y", placement: ["user_input", "ai_output"] }),
    ];
    const seed: LlmMessage[] = [
      msg("system", "X"),
      msg("user", "X"),
      msg("assistant", "X"),
      msg("user", "X"),
    ];

    const inlineCopy = seed.map((m) => ({ ...m }));
    const inline = await applyPromptRegexToArray(inlineCopy, PREBUILT, scripts);

    const req: RegexRunnerRequest = {
      requestId: "r1",
      prebuilt: PREBUILT,
      scripts,
      messages: seed.map((m) => ({ ...m })),
    };
    const reply = await runRegexRequest(req);

    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.changed).toBe(inline.changed);
      expect(reply.messages.map((m) => m.content)).toEqual(inlineCopy.map((m) => m.content));
      expect(reply.requestId).toBe("r1");
    }
  });

  test("empty script set is a no-op reply", async () => {
    const reply = await runRegexRequest({
      requestId: "r2",
      prebuilt: PREBUILT,
      scripts: [],
      messages: [msg("user", "X")],
    });
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.changed).toBe(false);
      expect(reply.messages.map((m) => m.content)).toEqual(["X"]);
    }
  });

  test("does not mutate the inbound messages array reference", async () => {
    const messages = [msg("user", "X")];
    const reply = await runRegexRequest({
      requestId: "r3",
      prebuilt: PREBUILT,
      scripts: [script({ find_regex: "X", replace_string: "Y", placement: ["user_input"] })],
      messages,
    });
    expect(reply.ok).toBe(true);
    expect(messages[0]!.content).toBe("X");
  });
});

describe("regexRunner default export — backend-process handler wiring", () => {
  test("calls ready(), answers a request by requestId, and completes on stop", async () => {
    let readyCalled = false;
    let messageHandler: ((payload: unknown) => void) | null = null;
    let stopHandler: ((detail: { reason?: string }) => void) | null = null;
    let completed = false;
    const sent: RegexRunnerReply[] = [];

    const ctx = {
      processId: "p1",
      entry: "dist/regex-runner.js",
      kind: "test",
      payload: undefined,
      ready() { readyCalled = true; },
      heartbeat() { /* noop */ },
      send(payload: unknown) { sent.push(payload as RegexRunnerReply); },
      onMessage(handler: (payload: unknown) => void) {
        messageHandler = handler;
        return () => { /* noop */ };
      },
      complete() { completed = true; },
      fail(_error: string) { /* noop */ },
      onStop(handler: (detail: { reason?: string }) => void) {
        stopHandler = handler;
        return () => { /* noop */ };
      },
    };

    const cleanup = regexRunner(ctx as never);
    expect(readyCalled).toBe(true);
    expect(typeof messageHandler).toBe("function");

    (messageHandler as unknown as (p: unknown) => void)({
      requestId: "req-1",
      prebuilt: PREBUILT,
      scripts: [script({ find_regex: "X", replace_string: "Y", placement: ["user_input"] })],
      messages: [msg("user", "X")],
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(sent.length).toBe(1);
    const reply = sent[0]!;
    expect(reply.requestId).toBe("req-1");
    expect(reply.ok).toBe(true);
    if (reply.ok) expect(reply.messages[0]!.content).toBe("Y");

    (stopHandler as unknown as (d: { reason?: string }) => void)({ reason: "test" });
    expect(completed).toBe(true);

    if (typeof cleanup === "function") cleanup();
  });

  test("fails a malformed request payload", async () => {
    let failed: string | null = null;
    let messageHandler: ((payload: unknown) => void) | null = null;
    const ctx = {
      processId: "p2",
      entry: "dist/regex-runner.js",
      kind: "test",
      payload: undefined,
      ready() { /* noop */ },
      heartbeat() { /* noop */ },
      send() { /* noop */ },
      onMessage(handler: (payload: unknown) => void) { messageHandler = handler; return () => {}; },
      complete() { /* noop */ },
      fail(error: string) { failed = error; },
      onStop() { return () => {}; },
    };
    regexRunner(ctx as never);
    (messageHandler as unknown as (p: unknown) => void)({ not: "a request" });
    expect(failed as string | null).toContain("malformed");
  });
});
