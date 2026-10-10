import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Random / dice / pick macros. Risu source: cbs.ts:1803-2108.
// Deterministic via SeededRng (seed = 0x6d2b79f5 default).

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("random (cbs.ts:2024)", () => {
  test("no args → [0,1) number", () => {
    const out = call("random");
    const n = Number(out);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
  });
  test("single-arg JSON array → picks one", () => {
    const out = call("random", ['["a","b","c"]']);
    expect(["a", "b", "c"]).toContain(out);
  });
  test("single-arg comma/colon-delimited → picks one", () => {
    const out1 = call("random", ["a,b,c"]);
    expect(["a", "b", "c"]).toContain(out1);
    const out2 = call("random", ["a:b:c"]);
    expect(["a", "b", "c"]).toContain(out2);
  });
  test("escaped comma stays literal", () => {
    const out = call("random", ["a\\,b"]);
    expect(out).toBe("a,b"); // single element, escape preserves comma
  });
  test("multi-arg → picks one", () => {
    const out = call("random", ["foo", "bar", "baz"]);
    expect(["foo", "bar", "baz"]).toContain(out);
  });
  test("deterministic across seeds", () => {
    const ctx = makeMockContext({ rngSeed: 42 });
    const a = call("random", ["a", "b", "c"], ctx);
    const ctx2 = makeMockContext({ rngSeed: 42 });
    const b = call("random", ["a", "b", "c"], ctx2);
    expect(a).toBe(b);
  });
});

describe("pick (cbs.ts:2033) — hash-deterministic", () => {
  test("same input + context → same output", () => {
    const a = call("pick", ["x", "y", "z"]);
    const b = call("pick", ["x", "y", "z"]);
    expect(a).toBe(b);
  });
  test("uses Risu's character-ID + chat-ID seed at chat.message.length", () => {
    const messages = [
      { role: "user" as const, content: "u", createdAt: 0 },
      { role: "assistant" as const, content: "a", createdAt: 0 },
    ];
    const args = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    expect(call("pick", args, makeMockContext({
      chatId: "chat-a",
      character: { chaId: "cha-1" },
      messages,
    }))).toBe("6");
    expect(call("pick", args, makeMockContext({
      chatId: "chat-a",
      character: { chaId: "cha-2" },
      messages,
    }))).toBe("4");
  });
});

describe("roll / rollp (cbs.ts:2047, 2076)", () => {
  test("no args → '1'", () => {
    expect(call("roll")).toBe("1");
    expect(call("rollp")).toBe("1");
  });
  test("1d6 within range", () => {
    const n = Number(call("roll", ["1d6"]));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  });
  test("2d10 within range (sum)", () => {
    const n = Number(call("roll", ["2d10"]));
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(20);
  });
  test("single number → single-die-Y notation", () => {
    const n = Number(call("roll", ["20"]));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(20);
  });
  test("invalid notation returns 'NaN'", () => {
    expect(call("roll", ["xdx"])).toBe("NaN");
    expect(call("roll", ["0d6"])).toBe("NaN"); // num < 1
  });
  test("rollp deterministic", () => {
    const a = call("rollp", ["2d6"]);
    const b = call("rollp", ["2d6"]);
    expect(a).toBe(b);
  });
  test("rollp uses the same Risu character-ID + chat-ID seed", () => {
    const messages = [
      { role: "user" as const, content: "u", createdAt: 0 },
      { role: "assistant" as const, content: "a", createdAt: 0 },
    ];
    expect(call("rollp", ["3d20"], makeMockContext({
      chatId: "chat-a",
      character: { chaId: "cha-1" },
      messages,
    }))).toBe("38");
    expect(call("rollp", ["3d20"], makeMockContext({
      chatId: "chat-b",
      character: { chaId: "cha-1" },
      messages,
    }))).toBe("39");
  });
});

describe("dice (cbs.ts:1826)", () => {
  test("XdY required", () => {
    const n = Number(call("dice", ["2d6"]));
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(12);
  });
  test("invalid → NaN", () => {
    expect(call("dice", ["abc"])).toBe("NaN");
    expect(call("dice", ["2"])).toBe("NaN"); // no 'd' split
  });
});

describe("randint (cbs.ts:1812)", () => {
  test("inclusive [min, max]", () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(call("randint", ["1", "3"], makeMockContext({ rngSeed: i + 1 })));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
  test("invalid → NaN", () => {
    expect(call("randint", ["a", "b"])).toBe("NaN");
  });
});

describe("hash (cbs.ts:1803)", () => {
  test("deterministic 7-digit", () => {
    const a = call("hash", ["hello"]);
    const b = call("hash", ["hello"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{7}$/);
  });
  test("different input → different (usually)", () => {
    expect(call("hash", ["hello"])).not.toBe(call("hash", ["world"]));
  });
});
