import { describe, test, expect } from "bun:test";
import { compileTriggers } from "../../src/core/mappers/triggers.js";
import type { TriggerScript } from "../../src/core/schemas/triggerscript.js";

function mk(over: Partial<TriggerScript> = {}): TriggerScript {
  return {
    comment: "t",
    type: "input",
    conditions: [],
    effect: [],
    ...over,
  } as TriggerScript;
}

describe("compileTriggers — binding map", () => {
  test("input → MESSAGE_SENT in triggers[]", () => {
    const out = compileTriggers([mk({ type: "input", comment: "one" })], { characterId: "C" });
    expect(out.files).toHaveLength(1);
    expect(out.files[0]!.triggers).toEqual(["MESSAGE_SENT"]);
  });
  test("output → GENERATION_ENDED", () => {
    const out = compileTriggers([mk({ type: "output", comment: "out1" })], { characterId: "C" });
    expect(out.files[0]!.triggers).toEqual(["GENERATION_ENDED"]);
  });
  test("display → CHARACTER_MESSAGE_RENDERED", () => {
    const out = compileTriggers([mk({ type: "display", comment: "disp" })], { characterId: "C" });
    expect(out.files[0]!.triggers).toEqual(["CHARACTER_MESSAGE_RENDERED"]);
  });
  test("start → ls:startup + CHAT_CHANGED", () => {
    const out = compileTriggers([mk({ type: "start", comment: "boot" })], { characterId: "C" });
    expect(out.files[0]!.triggers).toEqual(["ls:startup", "CHAT_CHANGED"]);
  });
  test("manual → library script (no triggers)", () => {
    const out = compileTriggers([mk({ type: "manual", comment: "btn" })], { characterId: "C" });
    expect(out.files[0]!.type).toBe("library");
    expect(out.files[0]!.triggers).toBeUndefined();
  });
  test("request → GENERATION_STARTED", () => {
    const out = compileTriggers([mk({ type: "request", comment: "req" })], { characterId: "C" });
    expect(out.files[0]!.triggers).toEqual(["GENERATION_STARTED"]);
  });

  test("invalid binding type surfaces as issue + skipped file", () => {
    const bad = mk({ type: "notAType" as never, comment: "x" });
    const out = compileTriggers([bad], { characterId: "C" });
    expect(out.files).toHaveLength(0);
    expect(out.issues[0]!.message).toContain("unknown binding");
  });
});

describe("compileTriggers — file structure", () => {
  test("emits AsyncFunction-body calling script.require", () => {
    const t = mk({ effect: [{ type: "setvar", var: "x", operator: "=", value: "1" }] as never });
    const out = compileTriggers([t], { characterId: "C" });
    const code = out.files[0]!.code;
    expect(code).toContain("// @type       trigger");
    expect(code).toContain('script.require("risu-compat")');
    expect(code).toContain("makeRisuTriggerRuntime");
    expect(code).toContain("await __risu.flush()");
    // Must NOT be an ES module.
    expect(code).not.toContain("export default");
    expect(code).not.toContain('import {');
  });

  test("V1 setvar + impersonate survive end-to-end (M14 backward-compat)", () => {
    const t = mk({
      type: "output",
      effect: [
        { type: "setvar", var: "a", operator: "=", value: "1" },
        { type: "impersonate", role: "char", value: "hi" },
      ] as never,
    });
    const out = compileTriggers([t], { characterId: "C" });
    const code = out.files[0]!.code;
    expect(code).toContain("setvarV1");
    expect(code).toContain("__risu.impersonate");
  });

  test("empty effect list produces runnable shell", () => {
    const out = compileTriggers([mk()], { characterId: "C" });
    const code = out.files[0]!.code;
    expect(code).toContain("(empty trigger body)");
  });

  test("unimplemented opcode tallies per type", () => {
    const t = mk({
      effect: [
        { type: "nope_one" },
        { type: "nope_one" },
        { type: "nope_two" },
      ] as never,
    });
    const out = compileTriggers([t], { characterId: "C" });
    expect(out.opcodeUnimplemented["nope_one"]).toBe(2);
    expect(out.opcodeUnimplemented["nope_two"]).toBe(1);
  });

  test("triggerlua bumps luaCount", () => {
    const t = mk({ effect: [{ type: "triggerlua", code: "print('hi')" }] as never });
    const out = compileTriggers([t], { characterId: "C" });
    expect(out.luaCount).toBe(1);
  });

  test("filename slugs from comment, unique per repeat", () => {
    const ts = [
      mk({ comment: "same name" }),
      mk({ comment: "same name" }),
    ];
    const out = compileTriggers(ts, { characterId: "C" });
    expect(out.files[0]!.path).toMatch(/same_name\.js$/);
    expect(out.files[1]!.path).toMatch(/same_name_2\.js$/);
  });

  test("bindings attached to character triggers", () => {
    const out = compileTriggers([mk({ type: "input", comment: "one" })], {
      characterId: "CID",
      characterName: "Alice",
    });
    expect(out.files[0]!.bindings).toEqual([
      { type: "character", characterId: "CID", displayName: "Alice" },
    ]);
  });

  test("manual trigger emits library with module.exports.run", () => {
    const out = compileTriggers(
      [mk({ type: "manual", comment: "btn", effect: [{ type: "setvar", var: "x", operator: "=", value: "1" }] as never })],
      { characterId: "C" },
    );
    const entry = out.files[0]!;
    expect(entry.type).toBe("library");
    expect(entry.code).toContain("module.exports = {");
    expect(entry.code).toContain("async run(invokeCtx)");
  });
});
