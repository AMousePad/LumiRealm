import { describe, test, expect } from "bun:test";
import { compileTrigger } from "../../src/core/triggers/compile.js";
import type { TriggerScript } from "../../src/core/schemas/triggerscript.js";

function mk(effect: unknown[], over: Partial<TriggerScript> = {}): TriggerScript {
  return {
    comment: "",
    type: "input",
    conditions: [],
    effect: effect as never,
    ...over,
  } as TriggerScript;
}

describe("M13 compiler — V1 flat effects", () => {
  test("V1 setvar emits a single line", () => {
    const t = mk([{ type: "setvar", var: "x", operator: "=", value: "1" }]);
    const out = compileTrigger(t);
    expect(out.body).toContain("__risu.setvarV1");
    expect(out.issues).toHaveLength(0);
  });

  test("V1 impersonate emits impersonate call", () => {
    const t = mk([{ type: "impersonate", role: "user", value: "hello" }]);
    const out = compileTrigger(t);
    expect(out.body).toContain("__risu.impersonate");
  });

  test("multiple V1 effects sequenced in order", () => {
    const t = mk([
      { type: "setvar", var: "x", operator: "=", value: "1" },
      { type: "impersonate", role: "user", value: "hi" },
      { type: "stop" },
    ]);
    const out = compileTrigger(t);
    const lines = out.body.split("\n").filter((l) => /__risu\.(setvarV1|impersonate|stopSending)/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("setvarV1");
    expect(lines[1]).toContain("impersonate");
    expect(lines[2]).toContain("stopSending");
  });
});

describe("M13 compiler — conditions gate", () => {
  test("conditions run before effects after template preparation", () => {
    const t = mk(
      [{ type: "setvar", var: "x", operator: "=", value: "1" }],
      { conditions: [{ type: "var", var: "y", value: "1", operator: "=" } as never] },
    );
    const out = compileTrigger(t);
    expect(out.hasConditions).toBe(true);
    expect(out.body.indexOf("checkConditions")).toBeLessThan(out.body.indexOf("setvarV1"));
  });

  test("empty conditions emit no guard", () => {
    const t = mk([{ type: "setvar", var: "x", operator: "=", value: "1" }]);
    const out = compileTrigger(t);
    expect(out.hasConditions).toBe(false);
    expect(out.body).not.toContain("checkConditions");
  });
});

describe("M13 compiler — unknown opcode handling", () => {
  test("unknown opcode surfaces as warn issue + comment", () => {
    // Unknown opcodes (likely a newer RisuAI version) are intentionally
    // emitted as `severity: 'warn'` for graceful degradation rather than
    // hard-fail at import. See `src/core/triggers/compile.ts:170-178`.
    const t = mk([{ type: "completelyFakeOpcode" }]);
    const out = compileTrigger(t);
    expect(out.issues.some((i) => i.severity === "warn" && i.message.startsWith("unknown opcode"))).toBe(true);
    expect(out.unimplementedCounts["completelyFakeOpcode"]).toBe(1);
    expect(out.body).toContain("unknown opcode");
  });
});

describe("M13 compiler — low-level access gating", () => {
  test("opcode needing lowLevelAccess is guarded by default", () => {
    const t = mk([{ type: "runLLM", value: "q", inputVar: "r" }]);
    const out = compileTrigger(t, { lowLevelAccess: false });
    expect(out.body).toContain("skipped");
  });

  test("low-level opcode runs when flag is set", () => {
    const t = mk([{ type: "runLLM", value: "q", inputVar: "r" }]);
    const out = compileTrigger(t, { lowLevelAccess: true });
    expect(out.body).toContain("__risu.runLLM");
  });
});
