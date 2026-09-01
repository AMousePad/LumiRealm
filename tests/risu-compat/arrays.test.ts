import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Array / dict helpers. Risu source: cbs.ts:1064-1294 + 1639-1665.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("arraylength (cbs.ts:1064)", () => {
  test("length", () => {
    expect(call("arraylength", ['["a","b","c"]'])).toBe("3");
    expect(call("arraylength", ['[]'])).toBe("0");
  });
});

describe("shift / pop / push (cbs.ts:1236-1267)", () => {
  test("shift drops first", () => {
    expect(call("arrayshift", ['["a","b","c"]'])).toBe('["b","c"]');
  });
  test("pop drops last", () => {
    expect(call("arraypop", ['["a","b","c"]'])).toBe('["a","b"]');
  });
  test("push appends", () => {
    expect(call("arraypush", ['["a","b"]', "c"])).toBe('["a","b","c"]');
  });
  test("operations on empty array are no-ops", () => {
    expect(call("arrayshift", ['[]'])).toBe("[]");
    expect(call("arraypop", ['[]'])).toBe("[]");
  });
});

describe("splice (cbs.ts:1269)", () => {
  test("replace 1 at index 1", () => {
    expect(call("arraysplice", ['["a","b","c"]', "1", "1", "x"])).toBe('["a","x","c"]');
  });
  test("insert (deleteCount=0)", () => {
    expect(call("arraysplice", ['["a","c"]', "1", "0", "b"])).toBe('["a","b","c"]');
  });
});

describe("arrayassert (cbs.ts:1280)", () => {
  test("extends when index OOB", () => {
    const result = call("arrayassert", ['["a"]', "2", "x"]);
    const parsed = JSON.parse(result);
    expect(parsed[2]).toBe("x");
    expect(parsed.length).toBe(3);
  });
  test("leaves alone when in-bounds", () => {
    expect(call("arrayassert", ['["a","b"]', "0", "x"])).toBe('["a","b"]');
  });
});

describe("arrayelement (cbs.ts:1178)", () => {
  test("positive and negative indices", () => {
    expect(call("arrayelement", ['["a","b","c"]', "1"])).toBe("b");
    expect(call("arrayelement", ['["a","b","c"]', "-1"])).toBe("c"); // .at() supports negatives
  });
  test("out-of-bounds returns 'null'", () => {
    expect(call("arrayelement", ['["a"]', "99"])).toBe("null");
  });
  test("object element stringified", () => {
    expect(call("arrayelement", ['[{"k":"v"}]', "0"])).toBe('{"k":"v"}');
  });
});

describe("dictelement (cbs.ts:1188)", () => {
  test("key lookup", () => {
    expect(call("dictelement", ['{"name":"John"}', "name"])).toBe("John");
    expect(call("dictelement", ['{"a":1}', "missing"])).toBe("null");
  });
});

describe("objectassert (cbs.ts:1198)", () => {
  test("sets when missing", () => {
    const out = call("objectassert", ['{"a":"1"}', "b", "2"]);
    expect(JSON.parse(out)).toEqual({ a: "1", b: "2" });
  });
  test("leaves when already present", () => {
    const out = call("objectassert", ['{"a":"1"}', "a", "999"]);
    expect(JSON.parse(out)).toEqual({ a: "1" });
  });
});

describe("element (cbs.ts:1211)", () => {
  test("single-level step", () => {
    // Risu parses JSON at each step, so a nested object is returned as an
    // object and the next JSON.parse fails in the try/catch — 'null'. Only
    // flat or string-nested structures walk cleanly.
    const out = call("element", ['{"name":"John"}', "name"]);
    expect(out).toBe("John");
  });
  test("array index access", () => {
    expect(call("element", ['["a","b","c"]', "1"])).toBe("b");
  });
  test("returns 'null' on bad step", () => {
    expect(call("element", ['{"a":1}', "missing"])).toBe("null");
    expect(call("element", ["not json", "a"])).toBe("null");
  });
  test("deep walk fails gracefully (Risu parity)", () => {
    // Nested object: first step returns an object, second JSON.parse throws
    // → caught and returns 'null'. Matches Risu cbs.ts:1228.
    expect(call("element", ['{"user":{"name":"John"}}', "user", "name"])).toBe("null");
  });
});

describe("makearray / makedict (cbs.ts:1294, 1303)", () => {
  test("makearray from varargs", () => {
    expect(call("makearray", ["a", "b", "c"])).toBe('["a","b","c"]');
    expect(call("makearray", [])).toBe("[]");
  });
  test("makedict from interleaved pairs", () => {
    expect(call("makedict", ["a", "1", "b", "2"])).toBe('{"a":"1","b":"2"}');
    expect(call("makedict", [])).toBe("{}");
  });
});

describe("range (cbs.ts:1544)", () => {
  test("single-arg [n] = 0..n-1", () => {
    expect(call("range", ["[5]"])).toBe('["0","1","2","3","4"]');
  });
  test("two-arg [a,b] = a..b-1", () => {
    expect(call("range", ["[2,5]"])).toBe('["2","3","4"]');
  });
  test("three-arg [a,b,s] with step", () => {
    expect(call("range", ["[2,8,2]"])).toBe('["2","4","6"]');
  });
});

describe("filter (cbs.ts:1639)", () => {
  test("all: non-empty + unique", () => {
    expect(call("filter", ['["a","","a","b"]', "all"])).toBe('["a","b"]');
  });
  test("nonempty: only drops empties", () => {
    expect(call("filter", ['["a","","b","","b"]', "nonempty"])).toBe('["a","b","b"]');
  });
  test("unique: keeps first occurrence", () => {
    expect(call("filter", ['["a","b","a","c"]', "unique"])).toBe('["a","b","c"]');
  });
});
