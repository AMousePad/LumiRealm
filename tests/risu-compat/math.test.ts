import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Diff tests for the math batch. Each case is a direct mirror of the
// behavior in Risu's cbs.ts (lines cited inline).

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("math: round/floor/ceil/abs (cbs.ts:1101-1136)", () => {
  test("round half-up, toward +Inf", () => {
    expect(call("round", ["3.7"])).toBe("4");
    expect(call("round", ["3.5"])).toBe("4");
    expect(call("round", ["3.4"])).toBe("3");
    expect(call("round", ["-3.5"])).toBe("-3"); // JS Math.round
    expect(call("round", ["-3.6"])).toBe("-4");
  });
  test("floor rounds toward -Inf", () => {
    expect(call("floor", ["3.9"])).toBe("3");
    expect(call("floor", ["-3.1"])).toBe("-4");
    expect(call("floor", ["0"])).toBe("0");
  });
  test("ceil rounds toward +Inf", () => {
    expect(call("ceil", ["3.1"])).toBe("4");
    expect(call("ceil", ["-3.9"])).toBe("-3");
  });
  test("abs removes sign", () => {
    expect(call("abs", ["-5"])).toBe("5");
    expect(call("abs", ["5"])).toBe("5");
    expect(call("abs", ["-3.14"])).toBe("3.14");
  });
  test("non-numeric input yields NaN stringification", () => {
    expect(call("round", ["abc"])).toBe("NaN");
  });
});

describe("math: remaind (cbs.ts:1137)", () => {
  test("modulo", () => {
    expect(call("remaind", ["10", "3"])).toBe("1");
    expect(call("remaind", ["10", "2"])).toBe("0");
    expect(call("remaind", ["-10", "3"])).toBe("-1"); // JS % preserves sign of dividend
  });
});

describe("math: pow (cbs.ts:1169)", () => {
  test("standard exponentiation", () => {
    expect(call("pow", ["2", "3"])).toBe("8");
    expect(call("pow", ["2", "0"])).toBe("1");
    expect(call("pow", ["2", "-1"])).toBe("0.5");
  });
});

describe("math: min/max/sum/average variadic (cbs.ts:1693-1756)", () => {
  test("multiple args", () => {
    expect(call("min", ["5", "2", "8"])).toBe("2");
    expect(call("max", ["5", "2", "8"])).toBe("8");
    expect(call("sum", ["1", "2", "3"])).toBe("6");
    expect(call("average", ["2", "4", "6"])).toBe("4");
  });
  test("JSON array passed as single arg", () => {
    expect(call("min", ['[5,2,8]'])).toBe("2");
    expect(call("max", ['[5,2,8]'])).toBe("8");
    expect(call("sum", ['[1,2,3]'])).toBe("6");
    expect(call("average", ['[2,4,6]'])).toBe("4");
  });
  test("non-numeric treated as 0", () => {
    expect(call("sum", ["1", "foo", "3"])).toBe("4");
    expect(call("min", ["5", "foo"])).toBe("0");
  });
  test("average of empty array is NaN", () => {
    expect(call("average", ["[]"])).toBe("NaN");
  });
});

describe("math: tonumber (cbs.ts:1158)", () => {
  test("keeps digits, dots, and whitespace (Risu parity — Number(' ') is 0)", () => {
    expect(call("tonumber", ["abc123.45def"])).toBe("123.45");
    expect(call("tonumber", ["1.2.3"])).toBe("1.2.3");
    expect(call("tonumber", ["42"])).toBe("42");
    // Risu uses !isNaN(Number(ch)) which is true for whitespace (Number('')===0).
    // Both the empty-input path and internal spaces pass through.
    expect(call("tonumber", ["no digits"])).toBe(" ");
    expect(call("tonumber", ["letters only"])).toBe(" ");
  });
});

describe("math: fixnum (cbs.ts:1758)", () => {
  test("toFixed semantics", () => {
    expect(call("fixnum", ["3.14159", "2"])).toBe("3.14");
    expect(call("fixnum", ["1", "3"])).toBe("1.000");
    expect(call("fixnum", ["1.5", "0"])).toBe("2"); // JS toFixed half-to-even sometimes, but 1.5→"2"
  });
});

describe("math: calc (cbs.ts:801)", () => {
  test("basic arithmetic", () => {
    expect(call("calc", ["2+2*3"])).toBe("8");
    expect(call("calc", ["(2+2)*3"])).toBe("12");
    expect(call("calc", ["10-3"])).toBe("7");
    expect(call("calc", ["10/4"])).toBe("2.5");
  });
  test("reads local vars via $x", () => {
    const ctx = makeMockContext();
    ctx.vars.set("local", "x", "5");
    const reg = registry.get("calc")!;
    expect(reg.handler(ctx, ["$x*2"], "")).toBe("10");
  });
  test("reads global vars via @x", () => {
    const ctx = makeMockContext();
    ctx.vars.set("global", "g", "7");
    const reg = registry.get("calc")!;
    expect(reg.handler(ctx, ["@g+1"], "")).toBe("8");
  });
});

describe("math: fromhex / tohex (cbs.ts:1845, 1854)", () => {
  test("round-trip", () => {
    expect(call("fromhex", ["FF"])).toBe("255");
    expect(call("tohex", ["255"])).toBe("ff");
    expect(call("fromhex", ["10"])).toBe("16");
    expect(call("tohex", ["0"])).toBe("0");
  });
});
