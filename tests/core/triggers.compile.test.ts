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
    const lines = out.body.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("setvarV1");
    expect(lines[1]).toContain("impersonate");
    expect(lines[2]).toContain("stopSending");
  });
});

describe("M13 compiler — v2 control flow", () => {
  test("v2If/EndIndent produces nested `if (cond) { … }`", () => {
    const t = mk([
      { type: "v2If", condition: "=", target: "1", targetType: "value", source: "x", indent: 0 },
      { type: "v2SetVar", var: "y", value: "2", valueType: "value", operator: "=", indent: 1 },
      { type: "v2EndIndent", indent: 1 },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("if (");
    expect(out.body).toContain("__risu.compare");
    expect(out.body).toContain("setvarV2");
    const openCount = (out.body.match(/\{/g) ?? []).length;
    const closeCount = (out.body.match(/\}/g) ?? []).length;
    expect(openCount).toBe(closeCount);
  });

  test("v2If/v2Else emits `if (…) { } else { }`", () => {
    const t = mk([
      { type: "v2If", condition: "=", target: "1", targetType: "value", source: "x", indent: 0 },
      { type: "v2SetVar", var: "y", value: "1", valueType: "value", operator: "=", indent: 1 },
      { type: "v2EndIndent", indent: 1 },
      { type: "v2Else", indent: 0 },
      { type: "v2SetVar", var: "y", value: "2", valueType: "value", operator: "=", indent: 1 },
      { type: "v2EndIndent", indent: 1 },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("} else {");
    expect(out.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    const open = (out.body.match(/\{/g) ?? []).length;
    const close = (out.body.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });

  test("v2LoopNTimes lowers to a for-loop", () => {
    const t = mk([
      { type: "v2LoopNTimes", value: "5", valueType: "value", indent: 0 },
      { type: "v2SetVar", var: "i", value: "1", valueType: "value", operator: "+=", indent: 1 },
      { type: "v2EndIndent", indent: 1, endOfLoop: true },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("for (");
    expect(out.body).toContain("< __risu_lim_0");
  });

  test("v2Loop (infinite) lowers to while(true) with loopTick guard", () => {
    const t = mk([
      { type: "v2Loop", indent: 0 },
      { type: "v2BreakLoop", indent: 1 },
      { type: "v2EndIndent", indent: 1, endOfLoop: true },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("while (true)");
    expect(out.body).toContain("__risu.loopTick");
    expect(out.body).toContain("break;");
  });

  test("v2BreakLoop at top level emits `return;` (Risu's breakLoop flag stops the walker)", () => {
    // Reproduction of corpus card a8935b05 (NEO-VENEZIA): manual trigger with
    // a top-level v2BreakLoop outside any loop. Risu's runner just halts the
    // effect walker; the translated function should exit cleanly.
    const t = mk([
      { type: "v2SetVar", var: "x", value: "1", valueType: "value", operator: "=", indent: 0 },
      { type: "v2BreakLoop", indent: 0 },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("return;");
    expect(out.body).not.toMatch(/^\s*break;/m);
  });

  test("v2BreakLoop inside v2Loop still emits `break;`", () => {
    const t = mk([
      { type: "v2Loop", indent: 0 },
      { type: "v2BreakLoop", indent: 1 },
      { type: "v2EndIndent", indent: 1, endOfLoop: true },
    ]);
    const out = compileTrigger(t);
    expect(out.body).toContain("break;");
  });

  test("orphan v2Else / v2EndIndent produces warn issue", () => {
    const t = mk([
      { type: "v2EndIndent", indent: 0 },
      { type: "v2Else", indent: 0 },
    ]);
    const out = compileTrigger(t);
    expect(out.issues.filter((i) => i.severity === "warn")).toHaveLength(2);
  });
});

describe("M13 compiler — conditions gate", () => {
  test("non-empty conditions emit guard at top", () => {
    const t = mk(
      [{ type: "setvar", var: "x", operator: "=", value: "1" }],
      { conditions: [{ type: "var", var: "y", value: "1", operator: "=" } as never] },
    );
    const out = compileTrigger(t);
    expect(out.hasConditions).toBe(true);
    expect(out.body.trimStart().startsWith("if (!__risu.checkConditions")).toBe(true);
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
