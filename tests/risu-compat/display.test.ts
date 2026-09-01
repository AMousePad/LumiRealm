import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Display/markup macros. Most are doc_only in Risu and shim to '' here; a
// few (decbo/bo/bc/displayescaped*) emit literal PUA sentinels.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("PUA bracket sentinels (cbs.ts:1397-1485)", () => {
  test("decbo/decbc/bo/bc", () => {
    expect(call("decbo")).toBe("\uE9B8");
    expect(call("decbc")).toBe("\uE9B9");
    expect(call("bo")).toBe("\uE9B8\uE9B8");
    expect(call("bc")).toBe("\uE9B9\uE9B9");
  });
  test("paren/angle/colon/semicolon sentinels", () => {
    expect(call("displayescapedbracketopen")).toBe("\uE9BA");
    expect(call("displayescapedbracketclose")).toBe("\uE9BB");
    expect(call("displayescapedanglebracketopen")).toBe("\uE9BC");
    expect(call("displayescapedanglebracketclose")).toBe("\uE9BD");
    expect(call("displayescapedcolon")).toBe("\uE9BE");
    expect(call("displayescapedsemicolon")).toBe("\uE9BF");
  });
});

describe("cbr (cbs.ts:1384)", () => {
  test("no args → literal '\\n'", () => {
    expect(call("cbr")).toBe("\\n");
  });
  test("numeric arg repeats", () => {
    expect(call("cbr", ["3"])).toBe("\\n\\n\\n");
  });
  test("minimum 1 repetition", () => {
    expect(call("cbr", ["0"])).toBe("\\n");
  });
});

describe("doc_only display wrappers → '' at prompt stage", () => {
  const names = [
    "asset", "image", "img", "video", "video-img", "audio", "bg", "bgm",
    "emotion", "path", "source",
    "position", "slot",
  ];
  test.each(names)("%s returns ''", (name) => {
    expect(call(name, ["anyName"])).toBe("");
  });
});

describe("position CBS staging", () => {
  test("stays literal during lore tokenization even when a stale buffer exists", () => {
    const ctx = {
      ...makeMockContext(),
      cbsContext: true,
      positionPt: { ITEMS: "stale giant prior-turn content" },
    };
    expect(call("position", ["ITEMS"], ctx)).toBe("{{position::ITEMS}}");
  });

  test("uses the current buffer outside CBS lore tokenization", () => {
    const ctx = {
      ...makeMockContext(),
      positionPt: { ITEMS: "current content" },
    };
    expect(call("position", ["ITEMS"], ctx)).toBe("current content");
  });
});

describe("inlay / inlayed / inlayeddata — Risu parser.svelte.ts:666-696", () => {
  // These were strip-to-empty stubs pre-session-25. Now real handlers:
  // `{{inlay::<id>}}` → bare <img>; `{{inlayed}}` / `{{inlayeddata}}`
  // wrap in `.x-risu-risu-inlay-image` div (the `x-risu-` prefix matches
  // Risu's parser class-rewrite output). The arg is a Lumi image id
  // (the handler doesn't validate, unknown ids produce a broken <img>,
  // matching browser behaviour on any missing image).
  test("inlay returns bare <img> with Lumi image URL", () => {
    expect(call("inlay", ["abc-uuid"])).toBe('<img src="/api/v1/images/abc-uuid"/>');
  });
  test("inlayed wraps in .x-risu-risu-inlay-image div", () => {
    expect(call("inlayed", ["abc-uuid"])).toBe(
      '<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/abc-uuid"/></div>\n\n',
    );
  });
  test("inlayeddata uses same wrapper as inlayed", () => {
    expect(call("inlayeddata", ["abc-uuid"])).toBe(
      '<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/abc-uuid"/></div>\n\n',
    );
  });
  test("empty id short-circuits to ''", () => {
    expect(call("inlay", [""])).toBe("");
    expect(call("inlayed", [""])).toBe("");
    expect(call("inlayeddata", [""])).toBe("");
  });
});

describe("bkspc / erase registry fallbacks", () => {
  test("direct handler calls are empty because the scanner owns buffer rewinds", () => {
    expect(call("bkspc")).toBe("");
    expect(call("erase")).toBe("");
  });
});
