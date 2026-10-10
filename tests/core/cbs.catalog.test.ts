import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog, loadCatalog, isComplete } from "../../src/core/cbs/catalog/index.js";

const CATALOG_PATH = join(import.meta.dir, "..", "..", "src", "core", "cbs", "catalog", "risu-macros.json");

function loadRaw(): unknown {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
}

describe("catalog schema", () => {
  test("risu-macros.json parses against the schema", () => {
    const raw = loadRaw();
    const catalog = parseCatalog(raw);
    expect(catalog.length).toBeGreaterThan(100); // 173 currently; sanity floor
  });

  test("every entry has a unique canonical name (after stripping # / :)", () => {
    const catalog = parseCatalog(loadRaw());
    const seen = new Set<string>();
    for (const e of catalog) {
      const key = e.name.startsWith("#") || e.name.startsWith(":") ? e.name.slice(1) : e.name;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("isComplete rejects UNCERTAIN argShape", () => {
    const entry = {
      name: "foo",
      aliases: [],
      category: "other" as const,
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "x",
      risuLine: 1,
      summary: "Does a thing.",
      notes: "",
    };
    expect(isComplete(entry)).toBe(false);
  });

  test("isComplete accepts a fully populated entry", () => {
    const entry = {
      name: "getvar",
      aliases: [],
      category: "variables" as const,
      argShape: "name",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: ["localVars" as const],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1,
      summary: "Reads a local variable by name.",
      notes: "",
    };
    expect(isComplete(entry)).toBe(true);
  });
});

describe("CatalogIndex", () => {
  test("find() resolves by canonical name (with block-marker stripped)", () => {
    const idx = loadCatalog(loadRaw());
    expect(idx.find("getvar")).not.toBeNull();
    // "#if" in the catalog should be findable as "if"
    expect(idx.find("if")).not.toBeNull();
  });

  test("find() returns null for unknown names", () => {
    const idx = loadCatalog(loadRaw());
    expect(idx.find("definitely_not_a_risu_macro_xyz")).toBeNull();
  });

  test("delegatesToLumiverse / needsRename partition the collision set", () => {
    const idx = loadCatalog(loadRaw());
    for (const e of idx.entries) {
      if (!e.lumiverseCollision) {
        expect(idx.delegatesToLumiverse(e.name.replace(/^[#:]/, ""))).toBe(false);
        expect(idx.needsRename(e.name.replace(/^[#:]/, ""))).toBe(false);
      } else {
        const key = e.name.replace(/^[#:]/, "");
        const delegates = idx.delegatesToLumiverse(key);
        const renames = idx.needsRename(key);
        // A collision must be exactly one of the two, never both.
        expect(delegates && renames).toBe(false);
        expect(delegates || renames).toBe(true);
      }
    }
  });

  test("skeletonEntries + completeEntries partition the full set", () => {
    const idx = loadCatalog(loadRaw());
    const skel = idx.skeletonEntries().length;
    const done = idx.completeEntries().length;
    expect(skel + done).toBe(idx.entries.length);
  });

  test("current catalog is still mostly skeleton (expected)", () => {
    const idx = loadCatalog(loadRaw());
    // As of M8 infrastructure commit, all 173 entries are skeleton
    // placeholders. We expect this to shrink toward 0 over M9.
    expect(idx.skeletonEntries().length).toBeGreaterThan(0);
  });
});
