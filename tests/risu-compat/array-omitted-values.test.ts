import { describe, expect, test } from "bun:test";
import { runPipeline } from "../../src/interpreter/evaluator/pipeline.js";

describe("Risu array macros preserve omitted values", () => {
  test.each([
    ["{{arraypush::[\"a\"]}}", "[\"a\",null]"],
    ["{{arraypush::[\"a\"]::}}", "[\"a\",\"\"]"],
    ["{{arraypush::[\"a\"]::null}}", "[\"a\",\"null\"]"],
    ["{{arraysplice::[\"a\",\"b\"]::0::1}}", "[null,\"b\"]"],
    ["{{arraysplice::[\"a\",\"b\"]::0::1::}}", "[\"\",\"b\"]"],
    ["{{arraysplice::[\"a\",\"b\"]::0::1::null}}", "[\"null\",\"b\"]"],
    ["{{arrayassert::[\"a\"]::3}}", "[\"a\",null,null,null]"],
    ["{{arrayassert::[\"a\"]::3::}}", "[\"a\",null,null,\"\"]"],
    ["{{arrayassert::[\"a\"]::0}}", "[\"a\"]"],
    ["{{arrayassert::[\"a\"]::1}}", "[\"a\",null]"],
    ...([
      ["arraylength", "1"], ["arrayshift", "[]"], ["arraypop", "[]"],
      ["arraypush", '["",null]'], ["arraysplice", '[null,""]'],
      ["arrayassert", '[""]'], ["arrayelement", ""], ["range", "[]"], ["filter", "[]"],
    ] as const).flatMap(([name, empty]) => [[`{{${name}}}`, `{{${name}}}`], [`{{${name}::}}`, empty]]),
  ])("%s", (template, expected) => {
    expect(runPipeline({
      template,
      phase: "display",
      chatId: "array-omitted-values",
      userName: "User",
      charName: "Character",
      character: {},
      chat: {},
      variables: {},
      suppressVarPersist: true,
    })).toBe(expected);
  });
});
