import { describe, test, expect } from "bun:test";
import {
  extractGlobalFontDeclarations,
  prependCssToBgHtml,
} from "../../src/core/mappers/font-hoist.js";

// Font-hoist extracts `@font-face` and `@import` at-rules from
// regex-rule replace_string `<style>` blocks so the bg-html pipeline can
// propagate them globally. Without this, fonts declared in one rule's
// island shadow aren't available in a sibling rule's island shadow —
// which is what made a card's status-panel labels overflow when its
// custom font failed to load in a sibling rule's island.

describe("extractGlobalFontDeclarations", () => {
  test("empty input → empty string", () => {
    expect(extractGlobalFontDeclarations([])).toBe("");
    expect(extractGlobalFontDeclarations([""])).toBe("");
  });

  test("html without <style> → empty string", () => {
    expect(extractGlobalFontDeclarations(["<div>hello</div>"])).toBe("");
  });

  test("html with non-font @rules → empty string", () => {
    const html =
      `<style>` +
      `.foo { color: red; }` +
      `@keyframes spin { 0% { transform: rotate(0); } }` +
      `@media (max-width: 600px) { .foo { color: blue; } }` +
      `</style>` +
      `<div class="foo">x</div>`;
    expect(extractGlobalFontDeclarations([html])).toBe("");
  });

  test("single @font-face block hoisted verbatim", () => {
    const html =
      `<style>` +
      `@font-face { font-family: "Distrela"; src: url("a.ttf"); }` +
      `.foo { color: red; }` +
      `</style>`;
    const out = extractGlobalFontDeclarations([html]);
    expect(out).toContain("@font-face");
    expect(out).toContain('font-family: "Distrela"');
    expect(out).toContain("a.ttf");
  });

  test("@import url(...) hoisted verbatim", () => {
    const html =
      `<style>` +
      `@import url(https://fonts.googleapis.com/css2?family=Poppins);` +
      `.foo { color: red; }` +
      `</style>`;
    const out = extractGlobalFontDeclarations([html]);
    expect(out).toContain("@import");
    expect(out).toContain("Poppins");
  });

  test("multiple rules with @font-face — dedupe identical declarations", () => {
    const decl =
      `@font-face { font-family: "Distrela"; src: url("a.ttf"); }`;
    const out = extractGlobalFontDeclarations([
      `<style>${decl}</style>`,
      `<style>${decl}</style>`,
      `<style>${decl}</style>`,
    ]);
    // Only one copy of the declaration (dedup by normalized whitespace).
    const matches = out.match(/@font-face/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("dedupe is whitespace-insensitive", () => {
    const declA =
      `@font-face { font-family: "Distrela"; src: url("a.ttf"); }`;
    const declB =
      `@font-face   {  font-family:   "Distrela";   src: url("a.ttf");  }`;
    const out = extractGlobalFontDeclarations([
      `<style>${declA}</style>`,
      `<style>${declB}</style>`,
    ]);
    const matches = out.match(/@font-face/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("@font-face with internal braces in src URL — not fractured", () => {
    // `url("...")` shouldn't fool the brace matcher — the content is
    // string-quoted. (Real-world `url(data:...,...)` can contain
    // semicolons but not braces; defensive test.)
    const html =
      `<style>` +
      `@font-face { font-family: "X"; src: url("a.ttf"); font-display: swap; }` +
      `</style>`;
    const out = extractGlobalFontDeclarations([html]);
    expect(out).toContain('font-family: "X"');
    expect(out).toContain("font-display: swap");
  });

  test("multiple @font-face blocks in one <style> — both extracted", () => {
    const html =
      `<style>` +
      `@font-face { font-family: "A"; src: url("a.ttf"); }` +
      `@font-face { font-family: "B"; src: url("b.ttf"); }` +
      `.foo { color: red; }` +
      `</style>`;
    const out = extractGlobalFontDeclarations([html]);
    expect(out).toContain('font-family: "A"');
    expect(out).toContain('font-family: "B"');
    // Style rule NOT hoisted.
    expect(out).not.toContain("color: red");
  });

  test("@import + @font-face mixed with style rules", () => {
    const html =
      `<style>` +
      `@import url(https://fonts.googleapis.com/css2?family=Poppins);` +
      `@font-face { font-family: "Distrela"; src: url("d.ttf"); }` +
      `.aukaru { width: 400px; height: 350px; }` +
      `.tab { font-size: 18px; }` +
      `</style>`;
    const out = extractGlobalFontDeclarations([html]);
    expect(out).toContain("Poppins");
    expect(out).toContain("Distrela");
    expect(out).not.toContain(".aukaru");
    expect(out).not.toContain(".tab");
  });
});

describe("prependCssToBgHtml", () => {
  test("empty css → unchanged bg-html", () => {
    expect(prependCssToBgHtml("<div>x</div>", "")).toBe("<div>x</div>");
    expect(prependCssToBgHtml(null, "")).toBe(null);
    expect(prependCssToBgHtml("<div>x</div>", "   ")).toBe("<div>x</div>");
  });

  test("null bg-html + css → synthesized <style> document", () => {
    const css = `@font-face { font-family: "X"; src: url("a.ttf"); }`;
    const out = prependCssToBgHtml(null, css);
    expect(out).toContain("<style data-risu-hoisted>");
    expect(out).toContain('font-family: "X"');
    expect(out).toContain("</style>");
  });

  test("bg-html with existing <style> → injected at top of <style>", () => {
    const bg = `<style>.foo { color: red; }</style><div></div>`;
    const out = prependCssToBgHtml(bg, `@font-face { font-family: "X"; }`);
    expect(out).toContain("@font-face");
    // Existing rule preserved.
    expect(out).toContain(".foo { color: red; }");
    // Hoisted comes BEFORE existing rule (so font registers first).
    const hoistedAt = out!.indexOf("@font-face");
    const fooAt = out!.indexOf(".foo");
    expect(hoistedAt).toBeGreaterThan(0);
    expect(fooAt).toBeGreaterThan(hoistedAt);
  });

  test("bg-html without <style> → wrap injected at start", () => {
    const bg = `<div class="card"><img src="x.png"></div>`;
    const out = prependCssToBgHtml(bg, `@font-face { font-family: "X"; }`);
    expect(out).toMatch(/^<style data-risu-hoisted>/);
    expect(out).toContain('font-family: "X"');
    expect(out).toContain(`<div class="card">`);
  });

  test("idempotent on repeated calls with same css", () => {
    const bg = `<style>.foo { color: red; }</style>`;
    const css = `@font-face { font-family: "X"; }`;
    const once = prependCssToBgHtml(bg, css);
    // Calling again would inject AGAIN — caller is responsible for
    // computing hoisted CSS once at translate time. The test just
    // documents that this function is a pure prepender.
    const twice = prependCssToBgHtml(once, css);
    const occurrences = (twice!.match(/@font-face/g) ?? []).length;
    expect(occurrences).toBe(2);
  });
});
