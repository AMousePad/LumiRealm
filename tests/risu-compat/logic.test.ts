import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Logic / comparison macros. Risu source: cbs.ts:889-1008 + 1667-1691.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("logic: equal / notequal (cbs.ts:889-905)", () => {
  test("string compare exact", () => {
    expect(call("equal", ["5", "5"])).toBe("1");
    expect(call("equal", ["5", "6"])).toBe("0");
    expect(call("notequal", ["5", "6"])).toBe("1");
    expect(call("notequal", ["5", "5"])).toBe("0");
  });
  test("case-sensitive", () => {
    expect(call("equal", ["Foo", "foo"])).toBe("0");
  });
  test("whitespace matters (no trim)", () => {
    expect(call("equal", ["a ", "a"])).toBe("0");
  });
});

describe("logic: numeric comparison (cbs.ts:907-940)", () => {
  test("greater/less/ge/le", () => {
    expect(call("greater", ["10", "5"])).toBe("1");
    expect(call("greater", ["5", "10"])).toBe("0");
    expect(call("greater", ["5", "5"])).toBe("0");
    expect(call("less", ["5", "10"])).toBe("1");
    expect(call("less", ["5", "5"])).toBe("0");
    expect(call("greaterequal", ["5", "5"])).toBe("1");
    expect(call("greaterequal", ["4", "5"])).toBe("0");
    expect(call("lessequal", ["5", "5"])).toBe("1");
    expect(call("lessequal", ["6", "5"])).toBe("0");
  });
  test("coerces strings to Number", () => {
    expect(call("greater", ["10", "9"])).toBe("1");
    // String compare would give "10" < "9", numeric gives 10 > 9.
  });
});

describe("logic: and / or / not (cbs.ts:943-968)", () => {
  test("boolean literal-'1' semantics", () => {
    expect(call("and", ["1", "1"])).toBe("1");
    expect(call("and", ["1", "0"])).toBe("0");
    expect(call("and", ["1", "true"])).toBe("0"); // only literal '1'
    expect(call("or", ["0", "1"])).toBe("1");
    expect(call("or", ["0", "0"])).toBe("0");
    expect(call("not", ["1"])).toBe("0");
    expect(call("not", ["0"])).toBe("1");
    expect(call("not", ["anything"])).toBe("1");
  });
});

describe("logic: all / any variadic (cbs.ts:1667-1691)", () => {
  test("multi-arg", () => {
    expect(call("all", ["1", "1", "1"])).toBe("1");
    expect(call("all", ["1", "0", "1"])).toBe("0");
    expect(call("any", ["0", "1", "0"])).toBe("1");
    expect(call("any", ["0", "0", "0"])).toBe("0");
  });
  test("JSON-array single arg", () => {
    expect(call("all", ['["1","1","1"]'])).toBe("1");
    expect(call("any", ['["0","1"]'])).toBe("1");
  });
});

describe("logic: startswith / endswith / contains (cbs.ts:983-1007)", () => {
  test("prefix / suffix / substring", () => {
    expect(call("startswith", ["Hello World", "Hello"])).toBe("1");
    expect(call("startswith", ["Hello World", "World"])).toBe("0");
    expect(call("endswith", ["Hello World", "World"])).toBe("1");
    expect(call("contains", ["Hello World", "lo Wo"])).toBe("1");
    expect(call("contains", ["Hello World", "xxx"])).toBe("0");
  });
  test("empty needle matches any prefix/suffix/substring", () => {
    expect(call("startswith", ["abc", ""])).toBe("1");
    expect(call("endswith", ["abc", ""])).toBe("1");
    expect(call("contains", ["abc", ""])).toBe("1");
  });
  test("case-sensitive", () => {
    expect(call("startswith", ["Hello", "hello"])).toBe("0");
  });
});

describe("logic: iserror (cbs.ts:1937)", () => {
  test("case-insensitive 'error:' prefix", () => {
    expect(call("iserror", ["Error: something"])).toBe("1");
    expect(call("iserror", ["error: lowercase"])).toBe("1");
    expect(call("iserror", ["ERROR: shouty"])).toBe("1");
    expect(call("iserror", ["Erro: typo"])).toBe("0");
    expect(call("iserror", ["ok"])).toBe("0");
  });
});
