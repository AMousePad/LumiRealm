import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// Misc utility macros. Risu citations inline.

function call(name: string, args: string[] = [], ctx = makeMockContext()): string {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler(ctx, args, "");
}

describe("u / ue — hex→char (cbs.ts:1785, 1794)", () => {
  test("hex to character", () => {
    expect(call("u", ["41"])).toBe("A");
    expect(call("ue", ["41"])).toBe("A");
    expect(call("u", ["2764"])).toBe("\u2764"); // ❤
  });
});

describe("unicodeencode / unicodedecode (cbs.ts:1767, 1776)", () => {
  test("round-trip", () => {
    expect(call("unicodeencode", ["A"])).toBe("65");
    expect(call("unicodedecode", ["65"])).toBe("A");
  });
  test("unicodeencode with index", () => {
    expect(call("unicodeencode", ["XYZ", "1"])).toBe("89"); // Y
  });
});

describe("xor / xordecrypt (cbs.ts:1947, 1960)", () => {
  test("round-trip via base64+XOR", () => {
    const enc = call("xor", ["hello"]);
    expect(call("xordecrypt", [enc])).toBe("hello");
  });
  test("deterministic", () => {
    expect(call("xor", ["hello"])).toBe(call("xor", ["hello"]));
  });
});

describe("crypt (cbs.ts:1973)", () => {
  test("self-inverting with default shift (32768)", () => {
    const enc = call("crypt", ["hello"]);
    expect(call("crypt", [enc])).toBe("hello");
  });
  test("custom shift round-trip", () => {
    const enc = call("crypt", ["hello", "1000"]);
    expect(call("crypt", [enc, "-1000"])).toBe("hello");
  });
  test("surrogate-pair handling (Risu parity — shifts each UTF-16 unit)", () => {
    // cbs.ts:1984 guards codes > 65535, but charCodeAt always returns 0-65535
    // for a UTF-16 code unit, so the guard never fires. 😀 (surrogate pair)
    // gets shifted unit-by-unit, producing mangled output. Round-trip still
    // works with matching +/- shifts.
    const enc = call("crypt", ["😀", "100"]);
    expect(call("crypt", [enc, "-100"])).toBe("😀");
  });
});

describe("date / datetimeformat (cbs.ts:1563, 1585)", () => {
  test("no args → YYYY-M-D from clock", () => {
    const ctx = makeMockContext({ now: Date.UTC(2024, 5, 9, 0, 0, 0) });
    const out = call("date", [], ctx);
    expect(out).toMatch(/^\d{4}-\d{1,2}-\d{1,2}$/);
  });
  test("datetimeformat alias behavior", () => {
    const ctx = makeMockContext({ now: Date.UTC(2024, 5, 9) });
    const d1 = call("date", [], ctx);
    const d2 = call("datetimeformat", [], ctx);
    expect(d1).toBe(d2);
  });
});

describe("hiddenkey / comment / // (cbs.ts:2111, 2129, 2257)", () => {
  test("hiddenkey returns ''", () => {
    expect(call("hiddenkey", ["anykey"])).toBe("");
  });
  test("comment returns '' in model mode", () => {
    expect(call("comment", ["some comment"])).toBe("");
  });
  test("// returns ''", () => {
    expect(call("//", ["ignored comment"])).toBe("");
  });
});

describe("tex / ruby (cbs.ts:2141, 2150)", () => {
  test("tex wraps in $$", () => {
    expect(call("tex", ["E=mc^2"])).toBe("$$E=mc^2$$");
  });
  test("ruby emits furigana HTML", () => {
    expect(call("ruby", ["漢字", "かんじ"])).toBe("<ruby>漢字<rp> (</rp><rt>かんじ</rt><rp>) </rp></ruby>");
  });
});

describe("codeblock (cbs.ts:2159)", () => {
  test("single-arg → plain <pre><code>", () => {
    expect(call("codeblock", ["a<b"])).toBe("<pre><code>a&lt;b</code></pre>");
  });
  test("two-arg → highlighted placeholder", () => {
    const out = call("codeblock", ["js", "console.log('x')"]);
    expect(out).toContain('<pre-hljs-placeholder lang="js">');
    expect(out).toContain("console.log(&#39;x&#39;)"); // quote escaped
  });
  test("special char escape", () => {
    expect(call("codeblock", ['<"&'])).toContain("&lt;&quot;&");
  });
});

describe("risu (cbs.ts:878)", () => {
  test("default size 45", () => {
    expect(call("risu")).toContain("height:45px");
  });
  test("custom size", () => {
    expect(call("risu", ["60"])).toContain("height:60px");
  });
});

describe("button (cbs.ts:869)", () => {
  test("label + risu-trigger", () => {
    const out = call("button", ["Click", "fire"]);
    expect(out).toBe('<button class="button-default x-risu-button-default" risu-trigger="fire">Click</button>');
  });
  test("HTML-escapes < > & in label (a calendar-nav card uses '<', '>')", () => {
    expect(call("button", ["<", "calendar_show_prev_month"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="calendar_show_prev_month">&lt;</button>',
    );
    expect(call("button", [">", "calendar_show_next_month"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="calendar_show_next_month">&gt;</button>',
    );
    expect(call("button", ["A&B", "x"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="x">A&amp;B</button>',
    );
  });
  test("preserves HTML entity glyph labels (Risu emits raw — times close button)", () => {
    expect(call("button", ["&times;", "closeAssetSettings"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="closeAssetSettings">&times;</button>',
    );
    expect(call("button", ["&#9881;", "x"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="x">&#9881;</button>',
    );
    expect(call("button", ["&#x2715;", "x"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="x">&#x2715;</button>',
    );
  });
  test("passes markdown block markers + - * # through verbatim", () => {
    expect(call("button", ["+", "calendar_add_event_prompt"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="calendar_add_event_prompt">+</button>',
    );
    expect(call("button", ["-", "calendar_remove_event_prompt"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="calendar_remove_event_prompt">-</button>',
    );
    expect(call("button", ["*", "x"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="x">*</button>',
    );
    expect(call("button", ["#", "x"])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="x">#</button>',
    );
  });
  test("escapes quote in trigger attribute", () => {
    // attribute injection guard — Lumi's sanitizer would clean this anyway,
    // but emitting valid attribute syntax avoids parser surprises upstream.
    expect(call("button", ["x", 'a"b'])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger="a&quot;b">x</button>',
    );
  });
  test("missing args render as empty (no NaN/undefined leakage)", () => {
    expect(call("button", [])).toBe(
      '<button class="button-default x-risu-button-default" risu-trigger=""></button>',
    );
  });
});

describe("screenwidth / screenheight (cbs.ts:1366, 1375)", () => {
  test("reads from ctx.screenWidth / screenHeight", () => {
    // Default mock ctx: 0 (matches Risu pre-browser-load)
    expect(call("screenwidth")).toBe("0");
    expect(call("screenheight")).toBe("0");
  });
  test("reports populated viewport from ctx", () => {
    const ctx = makeMockContext({ screenWidth: 1920, screenHeight: 1080 });
    expect(call("screenwidth", [], ctx)).toBe("1920");
    expect(call("screenheight", [], ctx)).toBe("1080");
  });
});

describe("moduleenabled / moduleassetlist (cbs.ts:1607, 1622)", () => {
  test("always '0' / '' without module state", () => {
    expect(call("moduleenabled", ["foo"])).toBe("0");
    expect(call("moduleassetlist", ["foo"])).toBe("");
  });
});

describe("metadata (cbs.ts:1863)", () => {
  test("imateapot", () => {
    expect(call("metadata", ["imateapot"])).toBe("🫖");
  });
  test("mobile/local/node → '0' (non-native)", () => {
    expect(call("metadata", ["mobile"])).toBe("0");
    expect(call("metadata", ["local"])).toBe("0");
    expect(call("metadata", ["node"])).toBe("0");
  });
  test("risutype → 'web'", () => {
    expect(call("metadata", ["risutype"])).toBe("web");
  });
  test("modelname reads ctx.aiModel", () => {
    const ctx = makeMockContext({ aiModel: "claude-opus" });
    expect(call("metadata", ["modelname"], ctx)).toBe("claude-opus");
    expect(call("metadata", ["modelshortname"], ctx)).toBe("claude-opus");
    expect(call("metadata", ["modelinternalid"], ctx)).toBe("claude-opus");
  });
  test("version / major read ctx.appVersion", () => {
    const ctx = makeMockContext({ appVersion: "2026.6.215" });
    expect(call("metadata", ["version"], ctx)).toBe("2026.6.215");
    expect(call("metadata", ["major"], ctx)).toBe("2026");
    expect(call("metadata", ["majorver"], ctx)).toBe("2026");
    expect(call("metadata", ["majorversion"], ctx)).toBe("2026");
  });
  test("maxcontext reads ctx.maxContext", () => {
    const ctx = makeMockContext({ maxContext: 32000 });
    expect(call("metadata", ["maxcontext"], ctx)).toBe("32000");
  });
  test("language and browserlanguage collapse to ctx.language", () => {
    const ctx = makeMockContext({ language: "en-US" });
    for (const k of ["language", "locale", "lang", "browserlanguage", "browserlocale", "browserlang"]) {
      expect(call("metadata", [k], ctx)).toBe("en-US");
    }
  });
  test("model format/provider/tokenizer stay unimplemented", () => {
    for (const k of ["modelformat", "modelprovider", "modeltokenizer"]) {
      expect(call("metadata", [k])).toStartWith("Error:");
    }
  });
  test("no supported key returns an iserror-positive string", () => {
    const ctx = makeMockContext({ appVersion: "2026.6.215", maxContext: 4096, language: "en-US" });
    for (const k of ["version", "major", "maxcontext", "language", "browserlang"]) {
      expect(call("iserror", [call("metadata", [k], ctx)], ctx)).toBe("0");
    }
  });
  test("case-insensitive key", () => {
    expect(call("metadata", ["IMATEAPOT"])).toBe("🫖");
  });
  test("unknown key returns error-form string", () => {
    expect(call("metadata", ["madeupkey"])).toBe("Error: madeupkey is not a valid metadata key.");
  });
});

describe("chatindex / firstmsgindex (cbs.ts:415, 424)", () => {
  test("chatindex reflects currentMessageIndex", () => {
    expect(call("chatindex", [], makeMockContext({ currentMessageIndex: 5 }))).toBe("5");
    expect(call("chatindex", [], makeMockContext({ currentMessageIndex: null }))).toBe("");
  });
  test("firstmsgindex returns chat.fmIndex (selectedAlternateGreetingIndex); -1 = default firstMessage", () => {
    expect(call("firstmsgindex")).toBe("-1");
    expect(call("firstmsgindex", [], makeMockContext({
      character: { selectedAlternateGreetingIndex: 2 } as never,
    }))).toBe("2");
  });
});
