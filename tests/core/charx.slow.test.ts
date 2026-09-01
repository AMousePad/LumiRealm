import { describe, test, expect } from "bun:test";
import { listLibraryCards } from "../helpers/local-library.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  findJpegZipBoundary,
  isZipArchive,
  isUnsafePath,
  readCharx,
} from "../../src/core/charx/index.js";
import { TranslationError } from "../../src/core/errors.js";

const listCharxs = (): string[] => listLibraryCards();

// ---------------------------------------------------------------------------
// Polyglot detection
// ---------------------------------------------------------------------------

describe("charx — polyglot detection", () => {
  test("pure ZIP detected", () => {
    const zip = zipSync({ "card.json": strToU8("{}") });
    expect(isZipArchive(zip)).toBe(true);
    expect(findJpegZipBoundary(zip)).toBe(-1);
  });

  test("JPEG+ZIP polyglot: boundary detected", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // SOI + APP0
      0xff, 0xd9, // EOI
    ]);
    const zip = zipSync({ "card.json": strToU8("{}") });
    const merged = new Uint8Array(jpeg.length + zip.length);
    merged.set(jpeg, 0);
    merged.set(zip, jpeg.length);

    const boundary = findJpegZipBoundary(merged);
    expect(boundary).toBe(jpeg.length);
  });

  test("plain JPEG without ZIP: no boundary", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0xff, 0xd9]);
    expect(findJpegZipBoundary(jpeg)).toBe(-1);
  });

  test("garbage bytes: no boundary", () => {
    expect(findJpegZipBoundary(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe(-1);
    expect(findJpegZipBoundary(new Uint8Array(0))).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Unsafe path policy
// ---------------------------------------------------------------------------

describe("charx — unsafe path policy", () => {
  test("safe paths accepted", () => {
    expect(isUnsafePath("card.json")).toBe(false);
    expect(isUnsafePath("module.risum")).toBe(false);
    expect(isUnsafePath("assets/icon/image/main.png")).toBe(false);
    expect(isUnsafePath("x_meta/main.json")).toBe(false);
    expect(isUnsafePath("a/b/c/d")).toBe(false);
  });

  test("parent references rejected", () => {
    expect(isUnsafePath("../etc/passwd")).toBe(true);
    expect(isUnsafePath("assets/../../etc")).toBe(true);
    expect(isUnsafePath("a/../b")).toBe(true);
    expect(isUnsafePath("..")).toBe(true);
  });

  test("absolute paths rejected", () => {
    expect(isUnsafePath("/etc/passwd")).toBe(true);
    expect(isUnsafePath("\\windows\\system32")).toBe(true);
    expect(isUnsafePath("C:/Windows")).toBe(true);
  });

  test("NUL bytes rejected", () => {
    expect(isUnsafePath("card\0.json")).toBe(true);
  });

  test("windows-style separators with parent refs rejected", () => {
    expect(isUnsafePath("assets\\..\\..\\etc")).toBe(true);
  });

  test("empty path rejected", () => {
    expect(isUnsafePath("")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Synthetic bundles
// ---------------------------------------------------------------------------

function buildMinimalCharx(extras: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "card.json": strToU8(JSON.stringify({ spec: "chara_card_v3", spec_version: "3.0", data: { name: "Test" } })),
    ...extras,
  });
}

describe("charx — synthetic bundles", () => {
  test("minimal card-only bundle reads", () => {
    const bytes = buildMinimalCharx();
    const r = readCharx(bytes);
    expect(r.card).toBeDefined();
    expect((r.card as { spec: string }).spec).toBe("chara_card_v3");
    expect(r.cardJsonText).toContain("chara_card_v3");
    expect(r.moduleBytes).toBeNull();
    expect(r.moduleEnvelope).toBeNull();
    expect(r.assets.size).toBe(0);
    expect(r.xMeta.size).toBe(0);
    expect(r.issues.length).toBe(0);
    expect(r.isPolyglot).toBe(false);
  });

  test("x_meta/*.json routed correctly", () => {
    const bytes = buildMinimalCharx({
      "x_meta/main.json": strToU8(JSON.stringify({ type: "PNG" })),
      "x_meta/avatar.json": strToU8(JSON.stringify({ foo: "bar" })),
    });
    const r = readCharx(bytes);
    expect(r.xMeta.size).toBe(2);
    expect(r.xMeta.get("x_meta/main.json")).toEqual({ type: "PNG" });
  });

  test("assets/ routed correctly", () => {
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const bytes = buildMinimalCharx({
      "assets/icon/image/main.png": imgBytes,
    });
    const r = readCharx(bytes);
    expect(r.assets.size).toBe(1);
    const stored = r.assets.get("assets/icon/image/main.png")!;
    expect(Array.from(stored)).toEqual(Array.from(imgBytes));
  });

  test("unsafe zip entries skipped, not thrown", () => {
    const bytes = zipSync({
      "card.json": strToU8("{}"),
      // fflate lets us write these — a malicious archive might contain them.
      "../escape.txt": strToU8("bad"),
    });
    const r = readCharx(bytes);
    expect(r.unsafeEntries).toContain("../escape.txt");
    expect(r.assets.has("../escape.txt")).toBe(false);
  });

  test("malformed card.json surfaces as issue, not throw", () => {
    const bytes = zipSync({ "card.json": strToU8("{not json") });
    const r = readCharx(bytes);
    expect(r.card).toBeNull();
    expect(r.cardJsonText).toBe("{not json");
    expect(r.issues.some((i) => i.path === "card.json")).toBe(true);
  });

  test("malformed x_meta JSON surfaces as issue", () => {
    const bytes = buildMinimalCharx({ "x_meta/bad.json": strToU8("{broken") });
    const r = readCharx(bytes);
    expect(r.xMeta.has("x_meta/bad.json")).toBe(false);
    expect(r.issues.some((i) => i.path === "x_meta/bad.json")).toBe(true);
  });

  test("non-zip input throws charx/not_zip", () => {
    expect(() => readCharx(new Uint8Array([1, 2, 3, 4]))).toThrow(TranslationError);
    try { readCharx(new Uint8Array([1, 2, 3, 4])); }
    catch (e) { expect((e as TranslationError).kind).toBe("charx/not_zip"); }
  });

  test("JPEG+ZIP polyglot round-trip: card recovered, jpegPreview captured", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const zip = buildMinimalCharx();
    const merged = new Uint8Array(jpeg.length + zip.length);
    merged.set(jpeg, 0);
    merged.set(zip, jpeg.length);
    const r = readCharx(merged);
    expect(r.isPolyglot).toBe(true);
    expect(r.jpegPreview).not.toBeNull();
    expect(r.jpegPreview!.length).toBe(jpeg.length);
    expect(r.card).toBeDefined();
  });

  test("oversized asset recorded, others still load", () => {
    const small = new Uint8Array([1, 2, 3]);
    const big = new Uint8Array(200); // 200 bytes
    const bytes = buildMinimalCharx({
      "assets/small.bin": small,
      "assets/big.bin": big,
    });
    const r = readCharx(bytes, { maxAssetBytes: 100 });
    expect(r.assets.has("assets/small.bin")).toBe(true);
    expect(r.assets.has("assets/big.bin")).toBe(false);
    expect(r.oversizedEntries.some((e) => e.path === "assets/big.bin")).toBe(true);
  });

  test("entry-count cap enforced", () => {
    const files: Record<string, Uint8Array> = { "card.json": strToU8("{}") };
    for (let i = 0; i < 20; i++) files[`assets/${i}.bin`] = new Uint8Array([i]);
    const bytes = zipSync(files);
    expect(() => readCharx(bytes, { maxEntryCount: 5 })).toThrow(TranslationError);
  });

  test("zip-bomb: aggregate decompressed cap fires before any inflate", () => {
    // Craft a legitimate-looking zip whose central directory declares
    // many entries summing well above maxTotalBytes, each under
    // maxEntryBytes (so not oversized-skipped). The precheck must throw
    // BEFORE any decompression happens. We verify by setting caps low
    // enough that a small handful of tiny entries already trips it.
    const files: Record<string, Uint8Array> = {
      "card.json": strToU8("{}"),
    };
    for (let i = 0; i < 10; i++) {
      files[`assets/f${i}.bin`] = new Uint8Array(600); // 600B each
    }
    const bytes = zipSync(files);
    // maxEntryBytes: 1000 (each entry fits) — maxTotalBytes: 2000
    // (sum > 2000 after ~4 entries) — expect throw with total_size_exceeded.
    expect(() =>
      readCharx(bytes, { maxAssetBytes: 1000, maxTotalBytes: 2000 }),
    ).toThrow(/total_size_exceeded|exceeds limit/);
  });

  test("zip-bomb: oversized entries don't count toward aggregate precheck", () => {
    // An entry that exceeds maxEntryBytes is marked oversized and skipped —
    // it must NOT count toward the aggregate sum, otherwise a legitimate
    // card with one huge asset would be rejected unfairly.
    const files: Record<string, Uint8Array> = {
      "card.json": strToU8("{}"),
      "assets/huge.bin": new Uint8Array(5000), // > maxEntryBytes, will be skipped
      "assets/small.bin": new Uint8Array(200),
    };
    const bytes = zipSync(files);
    const r = readCharx(bytes, { maxAssetBytes: 1000, maxTotalBytes: 1000 });
    expect(r.oversizedEntries.some((e) => e.path === "assets/huge.bin")).toBe(true);
    expect(r.assets.has("assets/small.bin")).toBe(true);
  });

  test("decodeModule: false leaves moduleEnvelope null", () => {
    // Build a fake module.risum — empty 7 bytes won't decode, so with
    // decodeModule:false it must not even try.
    const bytes = buildMinimalCharx({
      "module.risum": new Uint8Array([0x6f, 0x00, 0, 0, 0, 0, 0x00]), // empty wrapper
    });
    const r = readCharx(bytes, { decodeModule: false });
    expect(r.moduleBytes).not.toBeNull();
    expect(r.moduleEnvelope).toBeNull();
    expect(r.issues.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full 390-card corpus
// ---------------------------------------------------------------------------

describe("charx — corpus (390 cards)", () => {
  const charxs = listCharxs();
  if (charxs.length === 0) {
    test.skip("no corpus — run tools/fetch-corpus.ts", () => {});
    return;
  }

  interface Stats {
    total: number;
    polyglotCount: number;
    cardParsedCount: number;
    moduleDecodedCount: number;
    withoutModule: number;
    totalAssets: number;
    totalXMeta: number;
    totalIssues: number;
    hardFailures: { file: string; kind: string; message: string }[];
  }

  const stats: Stats = {
    total: 0,
    polyglotCount: 0,
    cardParsedCount: 0,
    moduleDecodedCount: 0,
    withoutModule: 0,
    totalAssets: 0,
    totalXMeta: 0,
    totalIssues: 0,
    hardFailures: [],
  };

  for (const path of charxs) {
    const name = path.split(/[\\/]/).pop()!;
    try {
      const bytes = new Uint8Array(readFileSync(path));
      // Heavy: decode module inline for the full corpus sweep.
      const r = readCharx(bytes);
      stats.total++;
      if (r.isPolyglot) stats.polyglotCount++;
      if (r.card !== null) stats.cardParsedCount++;
      if (r.moduleEnvelope !== null) stats.moduleDecodedCount++;
      if (r.moduleBytes === null) stats.withoutModule++;
      stats.totalAssets += r.assets.size;
      stats.totalXMeta += r.xMeta.size;
      stats.totalIssues += r.issues.length;
    } catch (e) {
      const kind = e instanceof TranslationError ? e.kind : "unknown";
      stats.hardFailures.push({ file: name, kind, message: (e as Error).message });
    }
  }

  test("every charx reads without hard failure", () => {
    if (stats.hardFailures.length > 0) {
      console.log("[charx corpus] hard failures:", stats.hardFailures.slice(0, 10));
    }
    expect(stats.hardFailures.length).toBe(0);
  });

  test("every corpus card parses card.json", () => {
    expect(stats.cardParsedCount).toBe(stats.total);
  });

  test("every corpus card's module.risum decodes (if present)", () => {
    // Some cards may lack module.risum entirely (e.g. legacy exports). We
    // count those in `withoutModule`; for the rest, decoding must succeed.
    expect(stats.moduleDecodedCount + stats.withoutModule).toBe(stats.total);
  });

  test("reports corpus charx stats", () => {
    console.log(`\n[charx corpus] ${stats.total} cards`);
    console.log(`  polyglot (JPEG+ZIP):  ${stats.polyglotCount}`);
    console.log(`  card.json parsed:     ${stats.cardParsedCount}`);
    console.log(`  module.risum present: ${stats.total - stats.withoutModule}`);
    console.log(`  module decoded:       ${stats.moduleDecodedCount}`);
    console.log(`  total assets:         ${stats.totalAssets}`);
    console.log(`  total x_meta files:   ${stats.totalXMeta}`);
    console.log(`  non-fatal issues:     ${stats.totalIssues}`);
    expect(stats.total).toBeGreaterThan(0);
  });
});
