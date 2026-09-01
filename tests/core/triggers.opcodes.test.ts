import { describe, test, expect } from "bun:test";
import { EMITTERS } from "../../src/core/triggers/opcodes/index.js";
import { KNOWN_V1_EFFECTS, KNOWN_V2_OPCODES, KNOWN_CODE_EFFECTS } from "../../src/core/schemas/triggerscript.js";
import type { EmitContext } from "../../src/core/triggers/types.js";

function makeCtx(over: Partial<EmitContext> = {}): EmitContext {
  return {
    indent: 1,
    issues: [],
    lowLevelAccess: false,
    displayMode: false,
    loopDepth: 0,
    ...over,
  };
}

describe("opcode registry coverage", () => {
  test("every V2 opcode has an emitter", () => {
    // Structural opcodes that M13 handles directly — emitters are no-ops but must exist.
    const missing = KNOWN_V2_OPCODES.filter((k) => !Object.prototype.hasOwnProperty.call(EMITTERS, k));
    expect(missing).toEqual([]);
  });

  test("every V1 effect has an emitter", () => {
    const missing = KNOWN_V1_EFFECTS.filter((k) => !Object.prototype.hasOwnProperty.call(EMITTERS, k));
    expect(missing).toEqual([]);
  });

  test("code effects (triggercode/triggerlua) have emitters", () => {
    for (const k of KNOWN_CODE_EFFECTS) {
      expect(Object.prototype.hasOwnProperty.call(EMITTERS, k)).toBe(true);
    }
  });
});

describe("V1 emitters", () => {
  test("setvar emits setvarV1 call with operator", () => {
    const result = EMITTERS.setvar!(
      { type: "setvar", var: "x", operator: "+=", value: "5" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.setvarV1");
    expect(result.code).toContain(`"x"`);
    expect(result.code).toContain(`"+="`);
    expect(result.code).toContain(`"5"`);
    expect(result.needsAwait).toBe(true);
  });

  test("impersonate emits role + value", () => {
    const result = EMITTERS.impersonate!(
      { type: "impersonate", role: "user", value: "hi" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.impersonate");
    expect(result.code).toContain(`"user"`);
  });

  test("systemprompt emits location + value", () => {
    const result = EMITTERS.systemprompt!(
      { type: "systemprompt", location: "historyend", value: "note" } as never,
      makeCtx(),
    );
    expect(result.code).toContain(`"historyend"`);
  });

  test("stop sets stopSending", () => {
    const result = EMITTERS.stop!({ type: "stop" } as never, makeCtx());
    expect(result.code).toContain("__risu.stopSending = true");
  });

  test("runLLM gated by lowLevelAccess", () => {
    const guarded = EMITTERS.runLLM!(
      { type: "runLLM", value: "q", inputVar: "r" } as never,
      makeCtx({ lowLevelAccess: false }),
    );
    expect(guarded.code).toContain("skipped");
    const allowed = EMITTERS.runLLM!(
      { type: "runLLM", value: "q", inputVar: "r" } as never,
      makeCtx({ lowLevelAccess: true }),
    );
    expect(allowed.code).toContain("__risu.runLLM");
  });
});

describe("V2 emitters — value dispatch", () => {
  test("v2SetVar threads operator + valueType through resolve", () => {
    const result = EMITTERS.v2SetVar!(
      { type: "v2SetVar", var: "x", value: "7", valueType: "value", operator: "=" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.setvarV2");
    expect(result.code).toContain(`"="`);
    expect(result.code).toContain(`__risu.resolve("7", "value")`);
  });

  test("v2If / v2EndIndent structural opcodes emit empty (M13 owns them)", () => {
    expect(EMITTERS.v2If!({ type: "v2If" } as never, makeCtx()).code).toBe("");
    expect(EMITTERS.v2EndIndent!({ type: "v2EndIndent" } as never, makeCtx()).code).toBe("");
  });

  test("v2Comment becomes a JS comment", () => {
    const result = EMITTERS.v2Comment!(
      { type: "v2Comment", value: "a note" } as never,
      makeCtx(),
    );
    expect(result.code.trim()).toBe("// a note");
  });

  test("v2StopTrigger emits `return;`", () => {
    expect(EMITTERS.v2StopTrigger!({ type: "v2StopTrigger" } as never, makeCtx()).code).toContain("return;");
  });

  test("v2Random routes min/max through resolve + Math.floor", () => {
    const result = EMITTERS.v2Random!(
      { type: "v2Random", min: "1", minType: "value", max: "10", maxType: "value", outputVar: "r" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.random");
    expect(result.code).toContain(`"1"`);
    expect(result.code).toContain(`"10"`);
  });

  test("display-only opcodes short-circuit to return when not displayMode", () => {
    const result = EMITTERS.v2GetDisplayState!(
      { type: "v2GetDisplayState", outputVar: "x" } as never,
      makeCtx({ displayMode: false }),
    );
    expect(result.code).toContain("return;");
  });

  test("v2SetDictVar skipped when varType='value'", () => {
    const result = EMITTERS.v2SetDictVar!(
      {
        type: "v2SetDictVar",
        var: "d",
        varType: "value",
        key: "k",
        keyType: "value",
        value: "v",
        valueType: "value",
      } as never,
      makeCtx(),
    );
    expect(result.code).toContain("skipped");
  });

  test("v2ImgGen gated by lowLevelAccess", () => {
    const guarded = EMITTERS.v2ImgGen!(
      {
        type: "v2ImgGen",
        value: "a", valueType: "value",
        negValue: "", negValueType: "value",
        outputVar: "o",
      } as never,
      makeCtx({ lowLevelAccess: false }),
    );
    expect(guarded.code).toContain("skipped");
  });
});

describe("V2 string / array / dict emitters", () => {
  test("v2ToLowerCase threads through resolve", () => {
    const result = EMITTERS.v2ToLowerCase!(
      { type: "v2ToLowerCase", source: "X", sourceType: "value", outputVar: "o" } as never,
      makeCtx(),
    );
    expect(result.code).toContain(".toLowerCase()");
  });

  test("v2PushArrayVar resolves value side", () => {
    const result = EMITTERS.v2PushArrayVar!(
      { type: "v2PushArrayVar", var: "arr", value: "1", valueType: "value" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.arrayPush");
  });

  test("v2GetDictKeys stringifies output", () => {
    const result = EMITTERS.v2GetDictKeys!(
      { type: "v2GetDictKeys", var: "d", varType: "var", outputVar: "o" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("JSON.stringify");
  });

  test("v2Calculate emits calculate call", () => {
    const result = EMITTERS.v2Calculate!(
      { type: "v2Calculate", expression: "1+1", expressionType: "value", outputVar: "o" } as never,
      makeCtx(),
    );
    expect(result.code).toContain("__risu.calculate");
  });
});
