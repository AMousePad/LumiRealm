import { describe, test, expect } from "bun:test";
import { buildBackgroundHtmlScript, expandShorthand } from "../../src/core/mappers/background-html.js";

describe("expandShorthand — {name} → {{getvar::name}}", () => {
  test("rewrites a bare identifier", () => {
    expect(expandShorthand("<p>{mood}</p>")).toBe("<p>{{getvar::mood}}</p>");
  });

  test("preserves `{{macro}}` blocks verbatim", () => {
    expect(expandShorthand("{{char}} is {mood}")).toBe("{{char}} is {{getvar::mood}}");
  });

  test("ignores CSS braces with whitespace", () => {
    const css = "body { padding: 10px; }";
    expect(expandShorthand(css)).toBe(css);
  });

  test("ignores CSS braces with newlines", () => {
    const css = ".x {\n color: red;\n}";
    expect(expandShorthand(css)).toBe(css);
  });

  test("ignores non-ident content", () => {
    expect(expandShorthand("{123}")).toBe("{123}"); // digits can't start ident
    expect(expandShorthand("{a b}")).toBe("{a b}");  // whitespace in body
    expect(expandShorthand("{}")).toBe("{}");        // empty
  });

  test("allows underscore and digit chars after first ident char", () => {
    expect(expandShorthand("{my_var_1}")).toBe("{{getvar::my_var_1}}");
  });

  test("multiple occurrences in one string", () => {
    expect(expandShorthand("{a} and {b}")).toBe("{{getvar::a}} and {{getvar::b}}");
  });
});

describe("buildBackgroundHtmlScript", () => {
  test("returns null when no HTML", () => {
    const r = buildBackgroundHtmlScript(null, { characterId: "C1" });
    expect(r.file).toBeNull();
  });

  test("emits a Lumiscript trigger bound to CHAT_CHANGED + ls:startup", () => {
    const r = buildBackgroundHtmlScript("<div>{mood}</div>", { characterId: "C1", characterName: "Alice" });
    expect(r.file).not.toBeNull();
    const f = r.file!;
    expect(f.name).toBe("risu-bg-html");
    expect(f.type).toBe("trigger");
    expect(f.triggers).toEqual(["CHAT_CHANGED", "ls:startup"]);
    expect(f.bindings).toEqual([
      { type: "character", characterId: "C1", displayName: "Alice" },
    ]);
  });

  test("inlines the expanded HTML as a string literal", () => {
    const html = "<div class='bg'>hi {mood}</div>";
    const r = buildBackgroundHtmlScript(html, { characterId: "C1" });
    expect(r.file!.code).toContain("{{getvar::mood}}");
    // The raw HTML is embedded as a JSON string literal.
    expect(r.file!.code).toContain('const HTML = "');
  });

  test("emitted code calls api.ui.dom.setBackgroundHtml OR api.broadcast", () => {
    const r = buildBackgroundHtmlScript("<p>hi</p>", { characterId: "C1" });
    const code = r.file!.code;
    expect(code).toContain("api.ui.dom.setBackgroundHtml");
    expect(code).toContain('api.broadcast.emit("risu:bg-html"');
  });
});
