import { describe, expect, test } from "bun:test";
import { runPipeline } from "../../src/interpreter/evaluator/pipeline.js";

describe("Risu inactive variable-write spelling", () => {
  test.each([
    { template: "{{SET_VAR:x:9}}|{{getvar::x}}", expected: "{{SET_VAR:x:9}}|2", mode: "literal" },
    { template: "{{setvar::x::9::extra}}|{{getvar::x}}", expected: "{{setvar::x::9::extra}}|2", mode: "literal" },
    { template: "{{setvar}}|{{getvar::x}}", expected: "{{setvar}}|2", mode: "literal" },
    { template: "{{setvar::x}}|{{getvar::x}}", expected: "{{setvar::x}}|2", mode: "literal" },
    { template: "{{setvar::x::{{char}}}}|{{getvar::x}}", expected: "{{setvar::x::Character}}|2", mode: "literal" },
    { template: "{{SET_VAR:x:9}}|{{getvar::x}}", expected: "|2", mode: "rmVar" },
    { template: "{{SET_VAR:x:9}}|{{getvar::x}}", expected: "|9", mode: "runVar" },
    { template: "{{ADD_VAR:x:9}}|{{getvar::x}}", expected: "{{ADD_VAR:x:9}}|2", mode: "literal" },
    { template: "{{addvar::x::9::extra}}|{{getvar::x}}", expected: "{{addvar::x::9::extra}}|2", mode: "literal" },
    { template: "{{addvar}}|{{getvar::x}}", expected: "{{addvar}}|2", mode: "literal" },
    { template: "{{addvar::x}}|{{getvar::x}}", expected: "{{addvar::x}}|2", mode: "literal" },
    { template: "{{addvar::x::{{char}}}}|{{getvar::x}}", expected: "{{addvar::x::Character}}|2", mode: "literal" },
    { template: "{{ADD_VAR:x:9}}|{{getvar::x}}", expected: "|2", mode: "rmVar" },
    { template: "{{ADD_VAR:x:9}}|{{getvar::x}}", expected: "|11", mode: "runVar" },
    { template: "{{SET_DEFAULT_VAR:x:9}}|{{getvar::x}}", expected: "{{SET_DEFAULT_VAR:x:9}}|2", mode: "literal" },
    { template: "{{setdefaultvar::x::9::extra}}|{{getvar::x}}", expected: "{{setdefaultvar::x::9::extra}}|2", mode: "literal" },
    { template: "{{setdefaultvar}}|{{getvar::x}}", expected: "{{setdefaultvar}}|2", mode: "literal" },
    { template: "{{setdefaultvar::x}}|{{getvar::x}}", expected: "{{setdefaultvar::x}}|2", mode: "literal" },
    { template: "{{setdefaultvar::x::{{char}}}}|{{getvar::x}}", expected: "{{setdefaultvar::x::Character}}|2", mode: "literal" },
    { template: "{{SET_DEFAULT_VAR:x:9}}|{{getvar::x}}", expected: "|2", mode: "rmVar" },
    { template: "{{SET_DEFAULT_VAR:x:9}}|{{getvar::x}}", expected: "|2", mode: "runVar" },
  ])("$mode: $template", ({ template, expected, mode }) => {
    expect(runPipeline({
      template,
      phase: mode === "runVar" ? "commit" : "display",
      chatId: "variable-literals",
      userName: "User",
      charName: "Character",
      character: {},
      chat: {},
      variables: { local: { x: "2" } },
      suppressVarPersist: true,
      ...(mode === "rmVar" ? { rmVar: true } : {}),
      ...(mode === "runVar" ? { runVar: true } : {}),
    })).toBe(expected);
  });
});
