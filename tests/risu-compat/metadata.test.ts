import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// declare/declared + character asset queries. Risu: cbs.ts:2247 (declare),
// 1324 (emotionlist), 1340 (assetlist), 1356 (prefillsupported),
// 1487 (chardisplayasset).

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("declare / declared (cbs.ts:2247)", () => {
  test("declare sets marker; declared reads it", () => {
    const ctx = makeMockContext();
    call("declare", ["foo"], ctx);
    expect(call("declared", ["foo"], ctx)).toBe("1");
    expect(call("declared", ["bar"], ctx)).toBe("0");
  });
  test("declare emits empty string", () => {
    expect(call("declare", ["x"])).toBe("");
  });
});

describe("emotionlist (cbs.ts:1324)", () => {
  test("lists emotion names", () => {
    const ctx = makeMockContext({
      character: {
        emotionImages: [
          { name: "happy", src: "a.png" },
          { name: "sad", src: "b.png" },
        ],
      } as any,
    });
    expect(call("emotionlist", [], ctx)).toBe('["happy","sad"]');
  });
  test("empty for no emotions", () => {
    expect(call("emotionlist")).toBe("[]");
  });
});

describe("assetlist (cbs.ts:1340)", () => {
  test("lists additional asset names", () => {
    const ctx = makeMockContext({
      character: {
        additionalAssets: [
          { name: "pic1", src: "a.png" },
          { name: "pic2", src: "b.png" },
        ],
      } as any,
    });
    expect(call("assetlist", [], ctx)).toBe('["pic1","pic2"]');
  });
  test("empty string for group characters", () => {
    const ctx = makeMockContext({
      character: { type: "group", additionalAssets: [{ name: "x", src: "x.png" }] } as any,
    });
    expect(call("assetlist", [], ctx)).toBe("");
  });
});

describe("prefillsupported (cbs.ts:1356)", () => {
  test("claude model → '1'", () => {
    expect(call("prefillsupported", [], makeMockContext({ aiModel: "claude-opus-4" }))).toBe("1");
    expect(call("prefillsupported", [], makeMockContext({ aiModel: "claude-haiku" }))).toBe("1");
  });
  test("non-claude → '0'", () => {
    expect(call("prefillsupported", [], makeMockContext({ aiModel: "gpt-4" }))).toBe("0");
    expect(call("prefillsupported", [], makeMockContext({ aiModel: "" }))).toBe("0");
  });
});

describe("file (cbs.ts:970) — prompt-mode decode", () => {
  test("decodes base64 to UTF-8", () => {
    const b64 = Buffer.from("hello world", "utf-8").toString("base64");
    expect(call("file", ["greeting.txt", b64])).toBe("hello world");
  });
  test("empty content → ''", () => {
    expect(call("file", ["f.txt", ""])).toBe("");
  });
});

describe("chardisplayasset (cbs.ts:1487)", () => {
  test("off when prebuiltAssetCommand=false", () => {
    const ctx = makeMockContext({
      character: {
        prebuiltAssetCommand: false,
        additionalAssets: [{ name: "a", src: "a.png" }],
      } as any,
    });
    expect(call("chardisplayasset", [], ctx)).toBe("[]");
  });
  test("lists non-excluded asset names", () => {
    const ctx = makeMockContext({
      character: {
        prebuiltAssetCommand: true,
        additionalAssets: [
          { name: "a", src: "a.png" },
          { name: "b", src: "b.png" },
          { name: "c", src: "c.png" },
        ],
        prebuiltAssetExclude: ["b.png"],
      } as any,
    });
    const out = JSON.parse(call("chardisplayasset", [], ctx));
    expect(out).toEqual(["a", "c"]);
  });
});
