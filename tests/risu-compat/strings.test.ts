import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// String manipulation. Risu source: cbs.ts:1010-1099 + 2120-2127.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("replace (cbs.ts:1010)", () => {
  test("global replace", () => {
    expect(call("replace", ["Hello World", "o", "0"])).toBe("Hell0 W0rld");
    expect(call("replace", ["aaa", "a", "b"])).toBe("bbb");
  });
  test("empty needle — JS replaceAll throws, we match Risu by using replaceAll", () => {
    // Empty-string needle is a special case in JS: replaceAll throws in some
    // engines. Risu uses String.prototype.replaceAll(args[1], args[2]).
    // Bun's engine: replaceAll('','x') inserts 'x' between every char.
    expect(call("replace", ["ab", "", "-"])).toBe("-a-b-");
  });
  test("case-sensitive", () => {
    expect(call("replace", ["Abc", "a", "X"])).toBe("Abc");
  });
});

describe("split (cbs.ts:1019)", () => {
  test("returns JSON array", () => {
    expect(call("split", ["a,b,c", ","])).toBe('["a","b","c"]');
    expect(call("split", ["abc", "."])).toBe('["abc"]');
  });
  test("empty delimiter splits every char", () => {
    expect(call("split", ["abc", ""])).toBe('["a","b","c"]');
  });
});

describe("join / spread (cbs.ts:1028, 1037)", () => {
  test("join uses delim", () => {
    expect(call("join", ['["a","b","c"]', ", "])).toBe("a, b, c");
    expect(call("join", ['[1,2,3]', "-"])).toBe("1-2-3");
  });
  test("spread uses :: always", () => {
    expect(call("spread", ['["a","b","c"]'])).toBe("a::b::c");
  });
});

describe("trim / length (cbs.ts:1046, 1055)", () => {
  test("trim strips both ends", () => {
    expect(call("trim", ["  hello  "])).toBe("hello");
    expect(call("trim", ["no-ws"])).toBe("no-ws");
    expect(call("trim", ["\t\n abc \n\t"])).toBe("abc");
  });
  test("length counts UTF-16 code units", () => {
    expect(call("length", ["hello"])).toBe("5");
    expect(call("length", [""])).toBe("0");
    // Note: Risu uses .length, which is UTF-16 code units not code points.
    // A surrogate pair (😀) = 2 in Risu too.
    expect(call("length", ["😀"])).toBe("2");
  });
});

describe("lower / upper / capitalize (cbs.ts:1074-1098)", () => {
  test("case transforms", () => {
    expect(call("lower", ["Hello WORLD"])).toBe("hello world");
    expect(call("upper", ["Hello world"])).toBe("HELLO WORLD");
    expect(call("capitalize", ["hello world"])).toBe("Hello world");
    expect(call("capitalize", [""])).toBe("");
  });
  test("locale-aware", () => {
    // Turkish lowercase İ → i with dot — locale-dependent; we just assert
    // the transform happens (not necessarily locale Turkish).
    expect(call("upper", ["ß"])).toMatch(/^S{1,2}$/); // "ß"→"SS" in JS via toLocaleUpperCase
  });
});

describe("reverse (cbs.ts:2120)", () => {
  test("reverses string", () => {
    expect(call("reverse", ["hello"])).toBe("olleh");
    expect(call("reverse", [""])).toBe("");
  });
  test("code-point safe (surrogate pairs)", () => {
    // 😀 is a single code point but 2 UTF-16 units; spread reverse keeps it.
    expect(call("reverse", ["a😀b"])).toBe("b😀a");
  });
});
