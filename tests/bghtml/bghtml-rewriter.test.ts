import { describe, expect, test } from "bun:test";
import {
  rewriteClassValue,
  rewriteHtmlClasses,
  rewriteCss,
  splitAndRewriteBgBundle,
} from "../../src/bghtml/rewriter.js";

// Evidence for the expected shape of every case below is cited against
// Risu's parser.svelte.ts.

// ─── Class token rewriter ────────────────────────────────────────────

describe("rewriteClassValue", () => {
  test("prefixes simple class", () => {
    expect(rewriteClassValue("foo")).toBe("x-risu-foo");
  });

  test("prefixes multiple class tokens", () => {
    expect(rewriteClassValue("foo bar baz")).toBe("x-risu-foo x-risu-bar x-risu-baz");
  });

  test("preserves hljs-* tokens (code highlighting carve-out)", () => {
    // Risu parser.svelte.ts:91 — `if (v.startsWith('hljs')) return v;`
    expect(rewriteClassValue("hljs-keyword foo")).toBe("hljs-keyword x-risu-foo");
  });

  test("idempotent on already-prefixed x-risu-* tokens", () => {
    // Risu parser.svelte.ts:94 — `if (v.startsWith('x-risu-')) return v;`
    expect(rewriteClassValue("x-risu-foo bar")).toBe("x-risu-foo x-risu-bar");
  });

  test("tolerates extra whitespace", () => {
    expect(rewriteClassValue("  foo    bar  ")).toBe("x-risu-foo x-risu-bar");
  });

  test("empty string passes through", () => {
    expect(rewriteClassValue("")).toBe("");
  });
});

// ─── HTML-level class attribute rewriter ─────────────────────────────

describe("rewriteHtmlClasses", () => {
  test("rewrites a single class attribute", () => {
    const input = '<div class="foo">x</div>';
    expect(rewriteHtmlClasses(input)).toBe('<div class="x-risu-foo">x</div>');
  });

  test("rewrites multi-token class attribute", () => {
    const input = '<div class="foo bar">x</div>';
    expect(rewriteHtmlClasses(input)).toBe('<div class="x-risu-foo x-risu-bar">x</div>');
  });

  test("handles single-quoted attributes", () => {
    const input = "<span class='foo bar'>y</span>";
    expect(rewriteHtmlClasses(input)).toBe("<span class='x-risu-foo x-risu-bar'>y</span>");
  });

  test("leaves non-class attributes alone", () => {
    const input = '<a href="#x" class="foo" id="bar">z</a>';
    expect(rewriteHtmlClasses(input)).toBe('<a href="#x" class="x-risu-foo" id="bar">z</a>');
  });

  test("preserves hljs and hljs-* tokens inside class attr", () => {
    // Risu parser.svelte.ts:91 uses `.startsWith('hljs')` (no dash) so
    // BOTH `hljs` (bare) and `hljs-keyword` are carved out.
    const input = '<code class="hljs hljs-keyword foo">x</code>';
    expect(rewriteHtmlClasses(input)).toBe(
      '<code class="hljs hljs-keyword x-risu-foo">x</code>',
    );
  });

  test("does not touch content inside class values that look like tags", () => {
    const input = '<div class="foo bar"><span class="baz">in</span></div>';
    expect(rewriteHtmlClasses(input)).toBe(
      '<div class="x-risu-foo x-risu-bar"><span class="x-risu-baz">in</span></div>',
    );
  });

  test("preserves elements without class attribute", () => {
    const input = "<div><span>no class</span></div>";
    expect(rewriteHtmlClasses(input)).toBe(input);
  });
});

// ─── CSS rewriter — happy path ───────────────────────────────────────

describe("rewriteCss — single simple rule", () => {
  test("prefixes class selector + adds .chattext scope", () => {
    // Risu parser.svelte.ts:901-910 — walkClasses renames + `.chattext ` prefix.
    const out = rewriteCss(".foo { color: red }");
    expect(out).toContain(".chattext .x-risu-foo");
    expect(out).toContain("color: red");
  });

  test("compound class selectors: all classes rewritten", () => {
    const out = rewriteCss(".foo.bar { color: red }");
    expect(out).toContain(".chattext .x-risu-foo.x-risu-bar");
  });

  test("nested descendant selectors: all classes rewritten, scope prepended", () => {
    const out = rewriteCss(".foo > .bar .baz { color: red }");
    expect(out).toContain(".chattext .x-risu-foo > .x-risu-bar .x-risu-baz");
  });

  test("pseudo-classes survive intact", () => {
    const out = rewriteCss(".foo:hover { color: red }");
    expect(out).toContain(".chattext .x-risu-foo:hover");
  });

  test("attribute selectors preserved (class still renamed)", () => {
    const out = rewriteCss(".foo[data-x='1'] { color: red }");
    expect(out).toContain(".chattext .x-risu-foo[data-x='1']");
  });

  test("selector lists rewritten per-item", () => {
    const out = rewriteCss(".foo, .bar { color: red }");
    expect(out).toContain(".chattext .x-risu-foo");
    expect(out).toContain(".chattext .x-risu-bar");
  });
});

// ─── CSS rewriter — universal selectors (divergence from Risu) ───────

describe("rewriteCss — universal → :host rewrite", () => {
  test("body { ... } → :host { ... }", () => {
    const out = rewriteCss("body { background: red }");
    // Should NOT be prefixed with .chattext — :host owns the root.
    expect(out).toContain(":host");
    expect(out).not.toContain(".chattext :host");
    expect(out).not.toContain(".chattext body");
  });

  test("html { ... } → :host { ... }", () => {
    const out = rewriteCss("html { font-family: Arial }");
    expect(out).toContain(":host");
  });

  test(":root { --x: 1 } → :host { --x: 1 }", () => {
    const out = rewriteCss(":root { --x: 1 }");
    expect(out).toContain(":host");
  });

  test("* { box-sizing: border-box } → :host { ... }", () => {
    const out = rewriteCss("* { box-sizing: border-box }");
    expect(out).toContain(":host");
  });

  test("body > .foo → :host > .x-risu-foo", () => {
    const out = rewriteCss("body > .foo { color: red }");
    expect(out).toContain(":host > .x-risu-foo");
    // Must NOT re-prefix — :host lead should suppress scope prefix.
    expect(out).not.toContain(".chattext :host");
  });

  test("body.dark → :host.dark (class gets rewritten too)", () => {
    const out = rewriteCss("body.dark { color: red }");
    // body is replaced with :host; .dark becomes .x-risu-dark.
    expect(out).toContain(":host.x-risu-dark");
  });

  test("opt-out leaves universal selectors alone", () => {
    const out = rewriteCss("body { background: red }", { rewriteUniversalToHost: false });
    expect(out).not.toContain(":host");
    expect(out).toContain(".chattext body");
  });
});

describe("rewriteCss — rewriteClassNames opt-out", () => {
  test("default: class tokens get x-risu- prefix", () => {
    const out = rewriteCss(".image-container { height: 25em }");
    expect(out).toContain(".x-risu-image-container");
    expect(out).not.toMatch(/\.image-container[\s{]/);
  });
  test("rewriteClassNames=false preserves original class tokens", () => {
    // Chat-scope injection path: selectors must target unprefixed classes
    // emitted by display-regex replace_strings. Evidence for the need:
    // a real card's ASSET rule produces `<div class="image-container">`
    // in message content; chat-scope CSS with `.x-risu-image-container`
    // would never match, sizing the div 0×0 (invisible).
    const out = rewriteCss(".image-container { height: 25em }", {
      rewriteClassNames: false,
      scopePrefix: "[data-message-id] ",
    });
    expect(out).toContain(".image-container");
    expect(out).not.toContain("x-risu-");
    expect(out).toContain("[data-message-id] .image-container");
  });
  test("rewriteClassNames=false still applies scope prefix + universal rewrite", () => {
    const out = rewriteCss("body .foo, html .bar { color: red }", {
      rewriteClassNames: false,
      scopePrefix: "[data-message-id] ",
    });
    expect(out).toContain(".foo");
    expect(out).toContain(".bar");
    expect(out).not.toContain("x-risu-");
    // Universal rewrite still fires (body/html → :host) because that opt
    // is independent.
    expect(out).toContain(":host");
  });
});

// ─── CSS rewriter — at-rules ─────────────────────────────────────────

describe("rewriteCss — at-rule handling", () => {
  test("@media block recurses", () => {
    const out = rewriteCss("@media (min-width: 600px) { .foo { color: red } }");
    expect(out).toContain("@media");
    expect(out).toContain(".chattext .x-risu-foo");
  });

  test("@supports block recurses", () => {
    const out = rewriteCss("@supports (display: grid) { .foo { display: grid } }");
    expect(out).toContain("@supports");
    expect(out).toContain(".chattext .x-risu-foo");
  });

  test("@keyframes inner selectors NOT rewritten", () => {
    const out = rewriteCss("@keyframes spin { 0% { opacity: 0 } 100% { opacity: 1 } }");
    expect(out).toContain("@keyframes spin");
    // 0% / 100% should survive verbatim.
    expect(out).toContain("0%");
    expect(out).toContain("100%");
    // Must NOT rewrite to `.chattext 0%` — that would be invalid.
    expect(out).not.toContain(".chattext 0%");
  });

  test("@keyframes with from/to keywords NOT rewritten", () => {
    const out = rewriteCss("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }");
    expect(out).toContain("from");
    expect(out).toContain("to");
    expect(out).not.toContain(".chattext from");
  });

  test("@font-face block passes through", () => {
    const css = "@font-face { font-family: 'X'; src: url(x.woff2) }";
    const out = rewriteCss(css);
    expect(out).toContain("@font-face");
    expect(out).toContain("font-family: 'X'");
  });

  test("@font-face declarations are NOT rewritten as selectors (regression: 2026-05-02)", () => {
    // `parseAtRule` previously recursed into the @font-face body via
    // the general `parseBlock` path. That made the serializer treat
    // `font-family: "Distrela"` as a selector and, with chat-scope
    // active, emit `[data-message-id] font-family: "Distrela" {}`,
    // breaking the declaration. Verified live against a real card's bg_html output.
    const css =
      `@font-face {
        font-family: "Distrela";
        src: url("d.ttf");
      }`;
    const out = rewriteCss(css, { scopePrefix: "[data-message-id] " });
    // Body must NOT be wrapped in chat-scope selector + braces.
    expect(out).not.toContain("[data-message-id] font-family");
    expect(out).not.toContain("[data-message-id] src:");
    // Declarations must survive intact.
    expect(out).toContain('font-family: "Distrela"');
    expect(out).toContain("src: url(");
    expect(out).toContain("d.ttf");
  });

  test("@font-face declarations also preserved with .chattext class-prefix path", () => {
    // The shadow-mounted bg-host path uses class-prefix rewriting +
    // `.chattext` ancestor scope. Same regression mechanism: parsing
    // declarations as nested rules.
    const css =
      `@font-face {
        font-family: "Distrela";
        src: url("d.ttf");
      }`;
    const out = rewriteCss(css, {
      scopePrefix: ".chattext ",
      rewriteClassNames: true,
    });
    expect(out).not.toContain(".chattext font-family");
    expect(out).not.toContain(".chattext src:");
    expect(out).toContain('font-family: "Distrela"');
  });

  test("@page / @property declaration at-rules also preserved verbatim", () => {
    // Same parser path; declaration-form at-rules generally.
    const out = rewriteCss(
      `@property --foo { syntax: "<color>"; initial-value: red; inherits: false; }`,
      { scopePrefix: "[data-message-id] " },
    );
    expect(out).not.toContain("[data-message-id] syntax");
    expect(out).not.toContain("[data-message-id] initial-value");
    expect(out).toContain('syntax: "<color>"');
    expect(out).toContain("initial-value: red");
  });

  test("@import url(https://...) preserved", () => {
    // Google Fonts etc. survive.
    const out = rewriteCss("@import url('https://fonts.googleapis.com/css2?family=Orbitron');");
    expect(out).toContain("https://fonts.googleapis.com/css2");
  });

  test("@import url(data:...) stubbed to data:, (Risu security posture)", () => {
    // parser.svelte.ts:921-923
    const out = rewriteCss("@import url('data:text/css,body{color:red}');");
    expect(out).toContain("data:,");
    expect(out).not.toContain("body{color:red}");
  });

  test("@import with data: without url() wrapper also stubbed", () => {
    const out = rewriteCss("@import 'data:text/css,x';");
    expect(out).toContain("data:,");
  });
});

// ─── CSS rewriter — edge cases ───────────────────────────────────────

describe("rewriteCss — edge cases", () => {
  test("preserves comments", () => {
    const out = rewriteCss("/* comment */ .foo { color: red }");
    expect(out).toContain("/* comment */");
    expect(out).toContain(".chattext .x-risu-foo");
  });

  test("empty stylesheet returns empty", () => {
    expect(rewriteCss("")).toBe("");
  });

  test("whitespace-only stylesheet preserved", () => {
    expect(rewriteCss("   \n  ")).toBe("   \n  ");
  });

  test("string literal containing brace does not unbalance parser", () => {
    const out = rewriteCss(`.foo::before { content: "{" }`);
    expect(out).toContain(".x-risu-foo::before");
    expect(out).toContain('content: "{"');
  });

  test("paren-delimited commas inside :is() / :where()", () => {
    const out = rewriteCss(":is(.foo, .bar) { color: red }");
    // The inner comma shouldn't split the selector list.
    // :is is a pseudo-class; we rewrite the classes inside it.
    expect(out).toContain(":is(.x-risu-foo, .x-risu-bar)");
  });

  test("id selector: NOT renamed, but scope prepended", () => {
    // Risu uses walkClasses only. IDs pass through untouched for
    // name, but line 910 prepends .chattext unconditionally.
    const out = rewriteCss("#my-id { color: red }");
    expect(out).toContain(".chattext #my-id");
  });

  test("tag selector: NOT renamed, scope prepended", () => {
    const out = rewriteCss("p { color: red }", { rewriteUniversalToHost: false });
    expect(out).toContain(".chattext p");
  });

  test("malformed CSS does not crash (degrades gracefully)", () => {
    // Unterminated rule — we emit it rather than discard.
    const out = rewriteCss(".foo { color: red");
    // No throw; output is something. Specific form is implementation-
    // defined; just assert the function didn't reject.
    expect(typeof out).toBe("string");
  });
});

// ─── Full bundle split ───────────────────────────────────────────────

describe("splitAndRewriteBgBundle", () => {
  test("separates <style> blocks from markup", () => {
    const input = `
<style>
  .foo { color: red }
</style>
<div class="foo">hi</div>
    `;
    const { css, html } = splitAndRewriteBgBundle(input);
    expect(css).toContain(".x-risu-foo");
    expect(css).toContain(".chattext");
    expect(html).toContain('class="x-risu-foo"');
    expect(html).not.toContain("<style");
  });

  test("multiple <style> blocks concatenated", () => {
    const input = `
<style>.a { color: red }</style>
<div class="a"></div>
<style>.b { color: blue }</style>
<div class="b"></div>
    `;
    const { css, html } = splitAndRewriteBgBundle(input);
    expect(css).toContain(".x-risu-a");
    expect(css).toContain(".x-risu-b");
    expect(html).toContain('class="x-risu-a"');
    expect(html).toContain('class="x-risu-b"');
  });

  test("bundle with no <style> produces empty css", () => {
    const { css, html } = splitAndRewriteBgBundle('<div class="foo">x</div>');
    expect(css).toBe("");
    expect(html).toContain('class="x-risu-foo"');
  });

  test("realistic bg_html snippet: large bundled-card pattern", () => {
    // Based on a real card's charx structure (89KB of bg_html with
    // @import + :root + ID selectors), abbreviated for test.
    const input = `<style>
      @import url('https://fonts.googleapis.com/css2?family=Orbitron');
      :root { --accent: #ff00aa; }
      #sip-wrap { width: 100%; }
      .image-container { width: 300px; height: 400px; }
    </style>
    <div id="sip-wrap">
      <div class="image-container"></div>
    </div>`;
    const { css, html } = splitAndRewriteBgBundle(input);
    // @import URL preserved (not data:).
    expect(css).toContain("fonts.googleapis.com");
    // :root → :host
    expect(css).toContain(":host");
    // Universal selector doesn't get .chattext prefix
    expect(css).not.toContain(".chattext :host");
    // #sip-wrap gets .chattext prefix
    expect(css).toContain(".chattext #sip-wrap");
    // .image-container class rewritten + scoped
    expect(css).toContain(".chattext .x-risu-image-container");
    // HTML classes rewritten
    expect(html).toContain('class="x-risu-image-container"');
    // IDs passed through unchanged
    expect(html).toContain('id="sip-wrap"');
  });
});
