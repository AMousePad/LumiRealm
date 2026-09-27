import { describe, expect, test } from "bun:test";
import { runPipeline } from "../../src/interpreter/evaluator/pipeline.js";

describe("Risu dictionary macros retain parsed JSON values", () => {
  test.each([
    ["{{dictelement::[\"a\",\"b\"]::1}}", "b"],
    ["{{objectelement::\"abc\"::1}}", "b"],
    ["{{dictelement::\"abc\"::length}}", "3"],
    ["{{dictelement::[\"a\"]::length}}", "1"],
    ["{{dictelement::null::x}}", "{{dictelement::null::x}}"],
    ["{{dictelement::42::x}}", "null"],
    ["{{dictelement::false::x}}", "null"],
    ["{{dictelement::invalid::x}}", "null"],
    ["{{objectassert::[\"a\"]::1::b}}", "[\"a\",\"b\"]"],
    ["{{dictassert::[\"a\"]::0::b}}", "[\"a\"]"],
    ["{{objectassert::[]::length::x}}", "{{objectassert::[]::length::x}}"],
    ["{{objectassert::\"abc\"::1::X}}", "\"abc\""],
    ["{{objectassert::\"abc\"::x::X}}", "{{objectassert::\"abc\"::x::X}}"],
    ["{{objectassert::42::x::X}}", "{{objectassert::42::x::X}}"],
    ["{{objectassert::false::x::X}}", "{{objectassert::false::x::X}}"],
    ["{{objectassert::null::x::X}}", "{{objectassert::null::x::X}}"],
    ["{{objectassert::invalid::x::X}}", "{\"x\":\"X\"}"],
    ["{{objectassert::{\"a\":false}::a::X}}", "{\"a\":\"X\"}"],
    ["{{objectassert::{\"a\":\"A\"}::a::X}}", "{\"a\":\"A\"}"],
  ])("%s", (template, expected) => {
    expect(runPipeline({
      template,
      phase: "display",
      chatId: "dictionary-json",
      userName: "User",
      charName: "Character",
      character: {},
      chat: {},
      variables: {},
      suppressVarPersist: true,
    })).toBe(expected);
  });
});
