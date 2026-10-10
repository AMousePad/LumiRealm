import { describe, expect, test } from "bun:test";
import {
  classifySvg,
  extractAndReplaceSvgs,
  inferDimensions,
  substituteSvgMarkers,
  SvgIndexer,
  SVG_PENDING_ATTR,
} from "../../src/core/svg-rasterize.js";

// ─── Classifier ─────────────────────────────────────────────────────

describe("classifySvg", () => {
  test("simple — pure shapes", () => {
    expect(
      classifySvg('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'),
    ).toBe("simple");
    expect(
      classifySvg('<svg><path d="M10 10h10"/></svg>'),
    ).toBe("simple");
  });

  test("templated — capture refs ($1-$9)", () => {
    expect(
      classifySvg('<svg><image href="$1"/></svg>'),
    ).toBe("templated");
    expect(
      classifySvg('<svg><text>$1</text></svg>'),
    ).toBe("templated");
  });

  test("templated — CBS macros ({{...}})", () => {
    expect(
      classifySvg('<svg><text>{{getvar::name}}</text></svg>'),
    ).toBe("templated");
  });

  test("animated — <animate>", () => {
    expect(
      classifySvg('<svg><circle r="5"><animate attributeName="r" to="10"/></circle></svg>'),
    ).toBe("animated");
  });

  test("animated — <animateTransform>", () => {
    expect(
      classifySvg('<svg><g><animateTransform type="rotate"/></g></svg>'),
    ).toBe("animated");
  });

  test("animated — CSS animation: property", () => {
    expect(
      classifySvg('<svg><style>circle{animation:spin 1s}</style><circle r="5"/></svg>'),
    ).toBe("animated");
  });

  test("theme-reactive — currentColor", () => {
    expect(
      classifySvg('<svg viewBox="0 0 24 24"><path fill="currentColor"/></svg>'),
    ).toBe("theme-reactive");
  });

  test("theme-reactive — var(--*)", () => {
    expect(
      classifySvg('<svg><circle fill="var(--lumiverse-accent)"/></svg>'),
    ).toBe("theme-reactive");
  });

  test("dangerous patterns classified as templated (skip)", () => {
    // <use href> — could be CORS pivot. Skip.
    expect(
      classifySvg('<svg><use href="https://evil.example/icon.svg"/></svg>'),
    ).toBe("templated");
    // <image href> — same.
    expect(
      classifySvg('<svg><image href="https://evil.example/img.png"/></svg>'),
    ).toBe("templated");
    // foreignObject — parser-reentry pivot.
    expect(
      classifySvg('<svg><foreignObject><div>x</div></foreignObject></svg>'),
    ).toBe("templated");
    // <script>.
    expect(
      classifySvg('<svg><script>alert(1)</script></svg>'),
    ).toBe("templated");
    // event handler attr.
    expect(
      classifySvg('<svg><circle onclick="x"/></svg>'),
    ).toBe("templated");
    // @import url in <style>.
    expect(
      classifySvg('<svg><style>@import url(http://x)</style></svg>'),
    ).toBe("templated");
  });

  test("templated wins over animated/theme/etc", () => {
    // Rule: if a card has both capture refs AND theme-reactive,
    // templated wins because we can't pre-rasterize either way.
    expect(
      classifySvg('<svg fill="currentColor"><image href="$1"/></svg>'),
    ).toBe("templated");
  });
});

// ─── Dimension inference ─────────────────────────────────────────────

describe("inferDimensions", () => {
  test("explicit width + height attrs", () => {
    expect(
      inferDimensions('<svg width="48" height="32"><path/></svg>'),
    ).toEqual({ width: 48, height: 32 });
  });

  test("falls back to viewBox", () => {
    expect(
      inferDimensions('<svg viewBox="0 0 100 50"><path/></svg>'),
    ).toEqual({ width: 100, height: 50 });
  });

  test("partial width + viewBox height fallback", () => {
    expect(
      inferDimensions('<svg width="64" viewBox="0 0 100 50"><path/></svg>'),
    ).toEqual({ width: 64, height: 50 });
  });

  test("default 32x32 when no width/height/viewBox", () => {
    expect(inferDimensions("<svg><path/></svg>")).toEqual({ width: 32, height: 32 });
  });

  test("clamps to 1..1024 range", () => {
    expect(
      inferDimensions('<svg width="0" height="9999"><path/></svg>'),
    ).toEqual({ width: 1, height: 1024 });
  });

  test("rounds floats", () => {
    expect(
      inferDimensions('<svg width="48.7" height="32.3"><path/></svg>'),
    ).toEqual({ width: 49, height: 32 });
  });

  test("only inspects opening <svg> tag (descendants don't influence)", () => {
    // Inner element has width/height — should be ignored.
    expect(
      inferDimensions(
        '<svg viewBox="0 0 24 24"><rect width="999" height="999"/></svg>',
      ),
    ).toEqual({ width: 24, height: 24 });
  });
});

// ─── Indexer + dedup ─────────────────────────────────────────────────

describe("SvgIndexer", () => {
  test("assigns sequential markers", () => {
    const idx = new SvgIndexer();
    expect(idx.add("<svg viewBox='0 0 1 1'><a/></svg>", "simple")).toBe(0);
    expect(idx.add("<svg viewBox='0 0 1 1'><b/></svg>", "simple")).toBe(1);
    expect(idx.add("<svg viewBox='0 0 1 1'><c/></svg>", "simple")).toBe(2);
    expect(idx.size()).toBe(3);
  });

  test("dedupes by content hash", () => {
    const idx = new SvgIndexer();
    const svgA = '<svg viewBox="0 0 24 24"><circle r="10"/></svg>';
    expect(idx.add(svgA, "simple")).toBe(0);
    expect(idx.add(svgA, "simple")).toBe(0); // same content → same marker
    expect(idx.add('<svg viewBox="0 0 24 24"><circle r="11"/></svg>', "simple")).toBe(1);
    expect(idx.size()).toBe(2);
  });

  test("dedup preserves first classification (doesn't double-count)", () => {
    const idx = new SvgIndexer();
    const svg = '<svg fill="currentColor"><a/></svg>';
    idx.add(svg, "theme-reactive");
    idx.add(svg, "theme-reactive"); // dedup
    expect(idx.getCounts()).toEqual({
      simple: 0,
      "theme-reactive": 1,
      animated: 0,
      templated: 0,
    });
  });

  test("counts by classification across distinct SVGs", () => {
    const idx = new SvgIndexer();
    idx.add("<svg viewBox='0 0 1 1'><a/></svg>", "simple");
    idx.add("<svg viewBox='0 0 1 1'><b/></svg>", "simple");
    idx.add('<svg fill="currentColor"><c/></svg>', "theme-reactive");
    idx.add('<svg><animate/></svg>', "animated");
    expect(idx.getCounts()).toEqual({
      simple: 2,
      "theme-reactive": 1,
      animated: 1,
      templated: 0,
    });
  });

  test("getTasks returns all unique tasks in insertion order", () => {
    const idx = new SvgIndexer();
    const svgs = [
      "<svg viewBox='0 0 24 24'><a/></svg>",
      "<svg viewBox='0 0 32 32'><b/></svg>",
      "<svg viewBox='0 0 24 24'><a/></svg>", // dup
    ];
    for (const s of svgs) idx.add(s, "simple");
    const tasks = idx.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.markerN).toBe(0);
    expect(tasks[1]!.markerN).toBe(1);
    expect(tasks[0]!.svg).toBe(svgs[0]!);
    expect(tasks[1]!.svg).toBe(svgs[1]!);
  });
});

// ─── Extractor ───────────────────────────────────────────────────────

describe("extractAndReplaceSvgs", () => {
  test("identity on input with no <svg>", () => {
    const idx = new SvgIndexer();
    const result = extractAndReplaceSvgs("<p>plain text</p>", idx);
    expect(result.rewritten).toBe("<p>plain text</p>");
    expect(idx.size()).toBe(0);
    expect(result.templatedSkipped).toBe(0);
  });

  test("replaces single simple SVG with placeholder", () => {
    const idx = new SvgIndexer();
    const input =
      '<div><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg></div>';
    const result = extractAndReplaceSvgs(input, idx);
    expect(result.rewritten).toBe(
      '<div><img data-lumirealm-svg-pending="0" alt="" width="24" height="24"></div>',
    );
    expect(idx.size()).toBe(1);
    expect(idx.getTasks()[0]!.classification).toBe("simple");
  });

  test("multiple SVGs in one string get sequential markers", () => {
    const idx = new SvgIndexer();
    const input =
      '<svg viewBox="0 0 16 16"><a/></svg> mid <svg viewBox="0 0 32 32"><b/></svg>';
    const result = extractAndReplaceSvgs(input, idx);
    expect(result.rewritten).toBe(
      '<img data-lumirealm-svg-pending="0" alt="" width="16" height="16"> mid <img data-lumirealm-svg-pending="1" alt="" width="32" height="32">',
    );
    expect(idx.size()).toBe(2);
  });

  test("identical SVGs across multiple sources share one marker (dedup)", () => {
    const idx = new SvgIndexer();
    const svg = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    const r1 = extractAndReplaceSvgs(`A${svg}B`, idx);
    const r2 = extractAndReplaceSvgs(`C${svg}D`, idx);
    // Both reference markerN=0.
    expect(r1.rewritten).toContain('data-lumirealm-svg-pending="0"');
    expect(r2.rewritten).toContain('data-lumirealm-svg-pending="0"');
    expect(idx.size()).toBe(1);
  });

  test("templated SVGs left inline + counter incremented", () => {
    const idx = new SvgIndexer();
    const input = '<div><svg><text>{{getvar::name}}</text></svg></div>';
    const result = extractAndReplaceSvgs(input, idx);
    // Inline preserved.
    expect(result.rewritten).toBe(input);
    expect(result.templatedSkipped).toBe(1);
    expect(idx.size()).toBe(0);
  });

  test("dangerous-pattern SVGs left inline + counted separately", () => {
    const idx = new SvgIndexer();
    const input = '<svg><use href="external.svg"/></svg>';
    const result = extractAndReplaceSvgs(input, idx);
    expect(result.rewritten).toBe(input);
    expect(result.dangerousSkipped).toBe(1);
    expect(result.templatedSkipped).toBe(0);
    expect(idx.size()).toBe(0);
  });

  test("mixed batch — simple + theme-reactive + templated", () => {
    const idx = new SvgIndexer();
    const input = [
      '<svg viewBox="0 0 16 16"><a/></svg>',
      '<svg fill="currentColor"><b/></svg>',
      '<svg><text>{{var}}</text></svg>',
    ].join(" ");
    const result = extractAndReplaceSvgs(input, idx);
    // First two replaced, third left inline.
    expect(result.rewritten).toContain('data-lumirealm-svg-pending="0"');
    expect(result.rewritten).toContain('data-lumirealm-svg-pending="1"');
    expect(result.rewritten).toContain('<svg><text>{{var}}</text></svg>');
    expect(result.templatedSkipped).toBe(1);
    expect(idx.size()).toBe(2);
    expect(idx.getCounts()).toEqual({
      simple: 1,
      "theme-reactive": 1,
      animated: 0,
      templated: 0, // templated count comes from extractAndReplaceSvgs return, not indexer
    });
  });

  test("empty input is identity", () => {
    const idx = new SvgIndexer();
    expect(extractAndReplaceSvgs("", idx).rewritten).toBe("");
  });
});

// ─── Marker substitution (backend post-rasterization) ───────────────

describe("substituteSvgMarkers", () => {
  test("substitutes single marker with image url", () => {
    const input = '<img data-lumirealm-svg-pending="0" alt="" width="24" height="24">';
    expect(substituteSvgMarkers(input, { 0: "abc-image-id" })).toBe(
      '<img src="/api/v1/images/abc-image-id" alt="" width="24" height="24">',
    );
  });

  test("substitutes multiple markers", () => {
    const input =
      '<img data-lumirealm-svg-pending="0" alt="" width="16" height="16"> ' +
      '<img data-lumirealm-svg-pending="1" alt="" width="32" height="32">';
    expect(substituteSvgMarkers(input, { 0: "id-a", 1: "id-b" })).toBe(
      '<img src="/api/v1/images/id-a" alt="" width="16" height="16"> ' +
        '<img src="/api/v1/images/id-b" alt="" width="32" height="32">',
    );
  });

  test("preserves placeholder when imageId is null/missing (raster failed)", () => {
    const input = '<img data-lumirealm-svg-pending="5" alt="" width="24" height="24">';
    // null mapping
    expect(substituteSvgMarkers(input, { 5: null })).toBe(input);
    // missing mapping
    expect(substituteSvgMarkers(input, {})).toBe(input);
  });

  test("idempotent on already-substituted content", () => {
    const input = '<img src="/api/v1/images/abc" alt="" width="24" height="24">';
    expect(substituteSvgMarkers(input, { 0: "xyz" })).toBe(input);
  });

  test("identity on input without markers", () => {
    const input = "<p>plain text</p>";
    expect(substituteSvgMarkers(input, { 0: "id" })).toBe(input);
    expect(substituteSvgMarkers("", { 0: "id" })).toBe("");
  });

  test("preserves attribute name in module exports", () => {
    expect(SVG_PENDING_ATTR).toBe("data-lumirealm-svg-pending");
  });
});
