import { describe, test, expect } from "bun:test";
import { expandShorthand } from "../../src/core/mappers/background-html.js";

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
