import { describe, expect, test } from "bun:test";
import { translateFromStoredSource } from "../../src/core/pipeline/translate.js";
import { TranslationError } from "../../src/core/errors.js";

function trigger(label: string) {
  return {
    comment: label,
    type: "input",
    conditions: [],
    effect: [{ type: "triggerlua", code: `print("${label}")` }],
  };
}

function regex(label: string) {
  return { comment: label, in: "needle", out: label, type: "editdisplay", ableFlag: true };
}

function source(module: unknown | null) {
  return {
    card: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Source selection",
        extensions: {
          risuai: {
            triggerscript: [trigger("character-only")],
            customScripts: [regex("character-only")],
          },
        },
      },
    },
    module,
  };
}

function verify(module: unknown | null, expected: string[]) {
  const input = source(module);
  const before = structuredClone(input);
  const bundle = translateFromStoredSource(input);
  expect(input).toEqual(before);
  expect(bundle.risuPayload?.triggers).toMatchObject(expected.map((comment) => ({ comment })));
  expect(bundle.risuPayload?.lua_scripts).toEqual(expected.map((label) => `print("${label}")`));
  expect(bundle.scripts.map((entry) => entry.name)).toEqual(
    expected.map((label) => `risu-trigger-input-${label}`),
  );
  expect(bundle.regexScripts.map((entry) => entry.replace_string)).toEqual(expected);
  expect(bundle.risuPayload?.requires.lua).toBe(expected.length > 0);
  for (const [index, entry] of bundle.scripts.entries()) {
    expect(entry.code).toContain(expected[index]!);
    expect(entry.triggers).toEqual(["MESSAGE_SENT"]);
  }
}

describe("embedded character source authority", () => {
  const metadata = { id: "embedded-source", name: "Embedded source", description: "" };

  test("embedded trigger and regex arrays replace character arrays", () => {
    verify({ ...metadata, trigger: [trigger("embedded-only")], regex: [regex("embedded-only")] }, ["embedded-only"]);
  });

  test("empty embedded arrays suppress character arrays", () => {
    verify({ ...metadata, trigger: [], regex: [] }, []);
  });

  test("missing embedded arrays suppress character arrays", () => {
    verify(metadata, []);
  });

  test("null embedded arrays suppress character arrays", () => {
    verify({ ...metadata, trigger: null, regex: null }, []);
  });

  test("a card without an embedded module retains its own arrays", () => {
    verify(null, ["character-only"]);
  });

  test("fatal embedded validation preserves its typed error instead of emitting empty runtime data", () => {
    const input = source({ id: "incomplete", trigger: [trigger("embedded-only")] });
    expect(() => translateFromStoredSource(input)).toThrow(TranslationError);
    try {
      translateFromStoredSource(input);
    } catch (error) {
      expect(error).toMatchObject({ kind: "schema/missing_required" });
    }
  });

  test("unexpected embedded parsing failures retain their cause in a typed error", () => {
    const cause = new Error("source read failed");
    const input = source({ ...metadata, get trigger() { throw cause; } });
    expect(() => translateFromStoredSource(input)).toThrow(TranslationError);
    try {
      translateFromStoredSource(input);
    } catch (error) {
      expect(error).toMatchObject({ kind: "pipeline/module_parse", cause });
    }
  });
});
