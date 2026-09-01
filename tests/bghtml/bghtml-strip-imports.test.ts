import { describe, test, expect } from "bun:test";
import { stripCssImports, splitCssImports } from "../../src/bghtml/strip-imports.js";

// `CSSStyleSheet.replaceSync()` throws on any `@import` rule, so it must be
// stripped before populating the constructed sheet that we adopt into
// per-island shadow roots. The chat-scope `<style>` in `document.head`
// still has the @imports, so font loading is unaffected.

describe("stripCssImports", () => {
  test("empty / no @import → unchanged", () => {
    expect(stripCssImports("")).toBe("");
    expect(stripCssImports(".foo { color: red }")).toBe(".foo { color: red }");
  });

  test("single @import url(http://...)", () => {
    const css = `@import url(https://fonts.googleapis.com/css2?family=Poppins);\n.foo { color: red; }`;
    const out = stripCssImports(css);
    expect(out).not.toContain("@import");
    expect(out).toContain(".foo");
  });

  test("@import url('...') with quotes", () => {
    const css = `@import url('https://x.com/a.css');\n.bar { }`;
    expect(stripCssImports(css)).not.toContain("@import");
  });

  test('@import url("...") with double quotes', () => {
    const css = `@import url("https://x.com/a.css");\n.bar { }`;
    expect(stripCssImports(css)).not.toContain("@import");
  });

  test("@import 'url-string' (no url() wrapper)", () => {
    const css = `@import 'https://x.com/a.css';\n.bar { }`;
    expect(stripCssImports(css)).not.toContain("@import");
  });

  test("@import with media-query tail", () => {
    const css = `@import url(a.css) screen and (max-width: 600px);\n.foo { }`;
    expect(stripCssImports(css)).not.toContain("@import");
    expect(stripCssImports(css)).toContain(".foo");
  });

  test("multiple @imports + non-@import rules → only @imports stripped", () => {
    const css =
      `@import url(a);\n` +
      `@import url(b);\n` +
      `@font-face { font-family: "X"; src: url(c); }\n` +
      `.foo { color: red; }`;
    const out = stripCssImports(css);
    expect(out).not.toContain("@import");
    // @font-face is allowed in replaceSync — preserved.
    expect(out).toContain("@font-face");
    expect(out).toContain('font-family: "X"');
    expect(out).toContain(".foo");
  });

  test("large-bundle shape: @import + @font-face + many style rules", () => {
    const css =
      `@import url(https://ik.imagekit.io/x/4564632.css);\n` +
      `@import url(https://fonts.googleapis.com/css2?family=Poppins);\n` +
      `@font-face { font-family: "Distrela"; src: url(d.ttf); }\n` +
      `.aukaru { width: 400px; }\n` +
      `.bar1 { height: 6px; }\n` +
      `.d1 { font-size: 6px; }`;
    const out = stripCssImports(css);
    expect(out.match(/@import/g)).toBeNull();
    expect(out).toContain("@font-face");
    expect(out).toContain(".aukaru");
    expect(out).toContain(".bar1");
    expect(out).toContain(".d1");
  });

  test("idempotent — second call is a no-op", () => {
    const css = `@import url(a);\n.foo { }`;
    const once = stripCssImports(css);
    const twice = stripCssImports(once);
    expect(once).toBe(twice);
  });

  test("@import inside an at-rule body — also stripped (defensive: rare and risky)", () => {
    // We only target top-level @import. CSS doesn't actually allow
    // @import inside other at-rules in practice, so this is just
    // defensive — the regex matches at any depth. Documented as a
    // soft limitation, not a correctness issue.
    const css = `@media (max-width: 600px) { @import url(nope); .foo { } }`;
    // Current regex DOES match inside @media — acceptable; @import
    // inside @media isn't valid CSS anyway, so removing it isn't
    // harmful.
    const out = stripCssImports(css);
    expect(out).not.toContain("@import");
    expect(out).toContain("@media");
    expect(out).toContain(".foo");
  });
});
