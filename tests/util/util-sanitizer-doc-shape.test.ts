import { describe, expect, test } from "bun:test";
import { normalizeReplaceStringForSanitizer } from "../../src/util/sanitizer-doc-shape.js";

describe("normalizeReplaceStringForSanitizer", () => {
  // ─── Fast path ──────────────────────────────────────────────────────

  test("fast path: plain body fragment passes through unchanged", () => {
    const input = '<div class="lc"><span>hi</span></div>';
    expect(normalizeReplaceStringForSanitizer(input)).toBe(input);
  });

  test("fast path: empty string", () => {
    expect(normalizeReplaceStringForSanitizer("")).toBe("");
  });

  test("fast path: text with no boundary tags", () => {
    expect(normalizeReplaceStringForSanitizer("hello world")).toBe(
      "hello world",
    );
  });

  test("fast path: <style>-bearing fragment that doesn't START with <style>", () => {
    // Fragment is already body-shaped — <div> precedes <style>.
    const input = '<div>x</div><style>.a{color:red}</style><div>y</div>';
    expect(normalizeReplaceStringForSanitizer(input)).toBe(input);
  });

  // ─── Document boundary stripping ────────────────────────────────────

  test("strips <!DOCTYPE>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '<!DOCTYPE html><div>x</div>',
    );
    expect(out).toBe('<div>x</div>');
  });

  test("strips <html> and </html>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '<html lang="en"><div>x</div></html>',
    );
    expect(out).toBe('<div>x</div>');
  });

  test("strips <body> and </body>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '<body class="x"><div>y</div></body>',
    );
    expect(out).toBe('<div>y</div>');
  });

  // ─── <head> handling ────────────────────────────────────────────────

  test("strips <head> entirely when it has no <style>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '<head><meta charset="UTF-8"><title>hi</title></head><div>body</div>',
    );
    expect(out).toBe('<div>body</div>');
  });

  test("lifts <style> from <head> to body context (anchored)", () => {
    const input =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>T</title>' +
      '<style>.lc{max-width:700px}</style></head><body><div class="lc">x</div></body></html>';
    const out = normalizeReplaceStringForSanitizer(input);
    // Anchor div precedes the lifted <style> because it's now leading.
    // No newline inserted between </style> and <div> — the head block
    // is replaced inline with extracted styles, no separator added
    // (single style → empty join). Multiple styles get '\n' between
    // (covered by the multi-style test).
    expect(out).toBe(
      '<div data-lr-style-wrap class="not-island-prose"><style>.lc{max-width:700px}</style><div class="lc">x</div></div>',
    );
  });

  test("lifts MULTIPLE <style> blocks from <head>", () => {
    const input =
      '<head><style>.a{}</style><style>.b{}</style></head><div>x</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toContain('<style>.a{}</style>');
    expect(out).toContain('<style>.b{}</style>');
    expect(out).toContain('<div>x</div>');
    // No leftover <head> tags or <meta> etc.
    expect(out).not.toContain('<head');
    expect(out).not.toContain('</head');
  });

  test("drops <title>/<meta>/<link>/<base> from <head>", () => {
    const input =
      '<head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width">' +
      '<title>Some Title</title>' +
      '<base href="/">' +
      '<link rel="stylesheet" href="x.css">' +
      '<style>.k{}</style>' +
      '</head>' +
      '<div>x</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('<title');
    expect(out).not.toContain('Some Title');
    expect(out).not.toContain('<base');
    expect(out).not.toContain('<link');
    expect(out).toContain('<style>.k{}</style>');
    expect(out).toContain('<div>x</div>');
  });

  test("orphan <head> opening with no closing — strips opener, keeps content stripped of forbidden tags", () => {
    const input = '<head><meta><div>oops</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    // Orphan <head> stripped, <meta> stripped, body content kept.
    expect(out).toBe('<div>oops</div>');
  });

  // ─── Leading <style> wrap ───────────────────────────────────────────

  test("wraps fragment in a div when starts with <style>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '<style>.x{}</style><div>y</div>',
    );
    expect(out).toBe(
      '<div data-lr-style-wrap class="not-island-prose"><style>.x{}</style><div>y</div></div>',
    );
  });

  test("wrap survives whitespace before <style>", () => {
    const out = normalizeReplaceStringForSanitizer(
      '   \n\n  <style>.x{}</style><div>y</div>',
    );
    expect(out).toBe(
      '<div data-lr-style-wrap class="not-island-prose"><style>.x{}</style><div>y</div></div>',
    );
  });

  test("does NOT wrap when fragment starts with a Strategy-1 block wrapper (<div>)", () => {
    // <div> is in Lumi's BLOCK_ELEMENT_RE — Strategy 1 catches the
    // balanced block, contains the trailing <style>, islands it, and
    // DOMPurify recurses into the <div> first → <style> survives.
    // Adding our own wrap would just nest redundantly.
    const out = normalizeReplaceStringForSanitizer(
      '<div>x</div><style>.y{}</style>',
    );
    expect(out).toBe('<div>x</div><style>.y{}</style>');
  });

  // ─── NEW: wrap when <style> is mid-content but leading element ──────
  // ─── isn't a Strategy-1 block wrapper (a real card's rule [21]) ──────

  test("wraps when fragment leads with <br> + has mid-content <style> (rule [21] shape)", () => {
    // A real card's rule [21] "🖥️" replace_string starts with six
    // <br> tags before the <style> block. <br> is NOT in Strategy 1's
    // BLOCK_ELEMENT_RE, so without the wrap:
    //   • Strategy 1 misses (wrong leading tag).
    //   • Strategy 2 fires on the <style> line and creates an island
    //     whose first element IS <style>.
    //   • DOMPurify in fragment mode routes leading <style> to head
    //     insertion → strips it.
    // CSS lost → @import for Cinzel font fails → text renders unstyled.
    // Wrap forces Strategy 1 to capture the <div> as the island; <style>
    // survives nested.
    const input = '<br>\n<br>\n<br>\n<style>@import url(google);.x{}</style>\n<div class="ui">x</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
    expect(out.endsWith('</div>')).toBe(true);
    expect(out).toContain('<br>');
    expect(out).toContain('@import url(google)');
    expect(out).toContain('<div class="ui">x</div>');
  });

  test("wraps when fragment leads with <p> (inline element, not block wrapper)", () => {
    // <p> is a block-level element in HTML semantics but NOT in Lumi's
    // Strategy 1 BLOCK_ELEMENT_RE — same wrap-needed class as <br>.
    const input = '<p>intro text</p><style>.x{font-size:14px}</style>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe('<div data-lr-style-wrap class="not-island-prose"><p>intro text</p><style>.x{font-size:14px}</style></div>');
  });

  test("wraps when fragment leads with text content + has mid-content <style>", () => {
    const input = 'Some intro\n<style>.x{}</style>\n<div>panel</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
    expect(out).toContain('Some intro');
    expect(out).toContain('<style>.x{}</style>');
    expect(out).toContain('<div>panel</div>');
  });

  test("wraps when fragment leads with <table> (Strategy 1 misses tables)", () => {
    // <table> is in Strategy 2's depth-tracker list but NOT Strategy 1's
    // BLOCK_ELEMENT_RE. Same wrap-needed class.
    const input = '<table><tr><td>x</td></tr></table><style>.x{}</style>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
    expect(out).toContain('<table>');
    expect(out).toContain('<style>.x{}</style>');
  });

  test("does NOT wrap when fragment starts with <section> (Strategy-1 wrapper)", () => {
    const input = '<section>x</section><style>.y{}</style>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe(input);
  });

  test("does NOT wrap when fragment starts with <details> (Strategy-1 wrapper)", () => {
    const input = '<details>x</details><style>.y{}</style>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe(input);
  });

  test("does NOT wrap portal-managed rule (data-risu-portal=auto leads)", () => {
    // Phase 2 portal-managed rules (a card's ♥️📆 PANEL rule et al.) ship
    // with `<div data-risu-portal="auto">` as the depth-zero element so
    // the resolver's outermostElementIsFixed extraction works. Adding
    // a wrap here would shift the leading element and could regress
    // Phase 2 detection. This test pins the no-double-wrap guarantee.
    const input = '<div data-risu-portal="auto"><style>.p{}</style><div>panel</div></div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe(input);
  });

  // ─── Comment-before-style (a real card's ⚙️CONTROL PANEL rule [7]) ──

  test("wraps when leading HTML comment precedes <style> (rule [7] shape)", () => {
    // The HTML5 parser treats <!-- comment --> as a non-element node;
    // the next ELEMENT (<style>) still routes to head context.
    // Without the wrap, DOMPurify fragment-mode discards the <style>.
    const input = '<!-- 상태창 제어판 --> <style>.sp-controls-container { padding: 25px; }</style><div class="sp-controls-container">x</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
    expect(out.endsWith('</div>')).toBe(true);
    // Comment preserved inside the wrap.
    expect(out).toContain('<!-- 상태창 제어판 -->');
    // CSS preserved.
    expect(out).toContain('padding: 25px');
    expect(out).toContain('<div class="sp-controls-container">x</div>');
  });

  test("wraps with multiple leading comments + whitespace + <style>", () => {
    const input = '<!-- a -->\n  <!-- b -->\n  <style>.x{}</style><div>y</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
    expect(out).toContain('<!-- a -->');
    expect(out).toContain('<!-- b -->');
    expect(out).toContain('<style>.x{}</style>');
  });

  test("does NOT wrap when leading comment precedes a non-style element", () => {
    // Comment first, then <div>, THEN style nested. Walk-past finds
    // <div> as the first element token — no wrap needed.
    const input = '<!-- comment --><div><style>.x{}</style></div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe(input);
  });

  test("does NOT wrap when fragment starts with text content (no element)", () => {
    // Pure text content with no <style> — fast path returns unchanged.
    const out = normalizeReplaceStringForSanitizer('Hello world');
    expect(out).toBe('Hello world');
  });

  test("malformed unclosed comment with embedded <style> wraps (defensive)", () => {
    // Unclosed comment: walk-past encounters <!-- with no -->,
    // returns false (no leading block wrapper detected). With the
    // extended wrap rule, "has <style> AND no leading block wrapper"
    // wraps — even when the parse is malformed. The wrap doesn't
    // RESCUE the malformed comment (browsers will treat the rest of
    // the input as comment text either way), but it's consistent
    // with the conservative "wrap if in doubt" default for any
    // <style>-bearing input that isn't already block-led. The card
    // author's malformed-comment bug stays the card author's bug.
    const input = '<!-- forgotten close <style>.x{}</style><div>y</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe('<div data-lr-style-wrap class="not-island-prose">' + input + '</div>');
  });

  test("malformed unclosed comment WITHOUT <style> passes through unchanged", () => {
    // No <style> in the input → fast-path early-out before any wrap
    // decision. Malformed comment doesn't matter; nothing to wrap for.
    const input = '<!-- forgotten close <div>y</div>';
    expect(normalizeReplaceStringForSanitizer(input)).toBe(input);
  });

  test("idempotent on comment-prefixed wrapped output", () => {
    const original = '<!-- x --><style>.x{}</style><div>y</div>';
    const once = normalizeReplaceStringForSanitizer(original);
    const twice = normalizeReplaceStringForSanitizer(once);
    expect(twice).toBe(once);
    // The wrap appeared on first application.
    expect(once.startsWith('<div data-lr-style-wrap class="not-island-prose">')).toBe(true);
  });

  // ─── Idempotency ─────────────────────────────────────────────────────

  test("idempotent: re-applying on already-normalized fragment is a no-op", () => {
    const original =
      '<!DOCTYPE html><html><head><style>.x{}</style></head><body><div>y</div></body></html>';
    const once = normalizeReplaceStringForSanitizer(original);
    const twice = normalizeReplaceStringForSanitizer(once);
    expect(twice).toBe(once);
  });

  test("idempotent: re-applying on a fragment that already has the wrap", () => {
    const wrapped = '<div data-lr-style-wrap class="not-island-prose"><style>.x{}</style><div>y</div></div>';
    expect(normalizeReplaceStringForSanitizer(wrapped)).toBe(wrapped);
  });

  // ─── Real-card-specific shape (the actual bug) ──────────────────────

  test("a real card's rule [17] FIRST MESSAGE shape, preserves <style>", () => {
    const firstMessageShape = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RisuAI Control Panel</title>
    <style>
        .lang-controls-container {
            background: linear-gradient(180deg, #2A2D35, #202228);
            max-width: 700px;
        }
        .lang-button {
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="lang-controls-container">
        <div class="lang-title">🌐 Control Panel 🌐</div>
        <div class="lang-button-wrapper">
            <div class="lang-button" risu-trigger="setLangToKorean">한국어</div>
            <div class="lang-button" risu-trigger="setLangToEnglish">English</div>
        </div>
    </div>
</body>
</html>`;
    const out = normalizeReplaceStringForSanitizer(firstMessageShape);
    // <style> block preserved with its CSS rules intact.
    expect(out).toContain('<style>');
    expect(out).toContain('.lang-controls-container');
    expect(out).toContain('max-width: 700px');
    expect(out).toContain('linear-gradient(180deg, #2A2D35, #202228)');
    // Body content preserved.
    expect(out).toContain('<div class="lang-controls-container">');
    expect(out).toContain('🌐 Control Panel 🌐');
    expect(out).toContain('risu-trigger="setLangToKorean"');
    // Boundary tags stripped.
    expect(out).not.toContain('<!DOCTYPE');
    expect(out).not.toContain('<html');
    expect(out).not.toContain('<head');
    expect(out).not.toContain('<body');
    expect(out).not.toContain('<title');
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('RisuAI Control Panel'); // (was in <title>)
    // Wrap present (because the lifted style is the leading element).
    expect(out).toContain('<div data-lr-style-wrap class="not-island-prose">');
    // Wrap closes at the end.
    expect(out.endsWith('</div>')).toBe(true);
  });

  // ─── Hostile / edge-case inputs ──────────────────────────────────────

  test("nested <head> tags (unusual) — both stripped", () => {
    const input = '<head><head></head></head><div>x</div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).not.toContain('<head');
    expect(out).toContain('<div>x</div>');
  });

  test("preserves <style> inside a body <div> wrapper untouched", () => {
    // <style> is nested inside a <div>, NOT at fragment top — already
    // safe for DOMPurify, the normalizer must not touch it.
    const input = '<div class="card"><style>.card{padding:10px}</style><span>x</span></div>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toBe(input);
  });

  test("very long head with mixed content — only style survives", () => {
    const input =
      '<!DOCTYPE html><html><head>' +
      '<meta charset="UTF-8">' +
      '<style>.a{color:red}</style>' +
      '<meta name="x" content="y">' +
      '<style>.b{color:blue}</style>' +
      '<title>T</title>' +
      '<link rel="x" href="y">' +
      '</head><body><p>hi</p></body></html>';
    const out = normalizeReplaceStringForSanitizer(input);
    expect(out).toContain('<style>.a{color:red}</style>');
    expect(out).toContain('<style>.b{color:blue}</style>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('<title');
    expect(out).not.toContain('<link');
    expect(out).not.toContain('<!DOCTYPE');
  });
});

// End-to-end DOMPurify verification was performed manually with
// `bun /tmp/sanitize-test*.ts` during development (jsdom + dompurify
// invoked directly). Confirmed:
//   - WITHOUT normalization: real-card-shape input → <style> stripped
//     by DOMPurify (HTML5 parser routes leading <style> to head; fragment
//     mode discards head content).
//   - WITH normalization: same input → <style> preserved through the
//     sanitizer round-trip.
// jsdom + dompurify aren't dev dependencies on this repo (Lumi's
// frontend pipeline runs in the browser, not under bun:test). The
// unit tests above exhaustively cover the normalizer's output shape
// — that's the fix surface; downstream behavior is locked by the
// manual proof + the corpus-suite live-fire smoke.
