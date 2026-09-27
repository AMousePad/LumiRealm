import { describe, expect, test } from "bun:test";
import { runPipeline } from "../../src/interpreter/evaluator/pipeline.js";

describe("Risu objectassert macros preserve omitted values", () => {
  test.each([
    ["{{objectassert::{}::x}}", "{}"],
    ["{{objectassert::{}::x::}}", "{\"x\":\"\"}"],
    ["{{dictassert::{\"x\":false}::x}}", "{}"],
    ["{{objectassert::{\"x\":false}::x::}}", "{\"x\":\"\"}"],
    ["{{objectassert::{\"x\":\"X\"}::x}}", "{\"x\":\"X\"}"],
    ["{{objectassert::[\"a\"]::1}}", "[\"a\",null]"],
    ["{{objectassert::[\"a\"]::1::}}", "[\"a\",\"\"]"],
    ["{{objectassert::[\"a\"]::0}}", "[\"a\"]"],
    ["{{objectassert::[]::3}}", "[null,null,null,null]"],
    ["{{objectassert::invalid::x}}", "{}"],
    ["{{objectassert::null::x}}", "{{objectassert::null::x}}"],
    ["{{objectassert::\"abc\"::x}}", "{{objectassert::\"abc\"::x}}"],
    ['{{dictelement::{"undefined":"U","":"E"} }}', "U"],
    ['{{objectelement::{"undefined":"U","":"E"}::}}', "E"],
    ['{{dictelement::{"undefined":0} }}', "0"],
    ['{{objectassert::{"undefined":false,"":"E"} }}', '{"":"E"}'],
    ['{{objectassert::{"undefined":false,"":"E"}::}}', '{"undefined":false,"":"E"}'],
    ["{{object_assert}}", "{}"],
    ['{{dictelement::{"undefined":"U"}}}', "null}"],
  ])("%s", (template, expected) => {
    expect(runPipeline({
      template,
      phase: "display",
      chatId: "objectassert-omitted-values",
      userName: "User",
      charName: "Character",
      character: {},
      chat: {},
      variables: {},
      suppressVarPersist: true,
    })).toBe(expected);
  });
});
