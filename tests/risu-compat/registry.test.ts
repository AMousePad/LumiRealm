import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../../src/risu-compat/index.js";
import { parseCatalog, CatalogIndex, isComplete } from "../../src/core/cbs/index.js";

/**
 * Registry + catalog discipline tests.
 *
 * Every registered handler in `risu-compat` MUST correspond to a catalog
 * entry that passes `isComplete()`. Runtime names are registered exactly as
 * RisuAI accepts them; host collisions do not alter the compatibility name.
 */

const CATALOG_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "src",
  "core",
  "cbs",
  "catalog",
  "risu-macros.json",
);

function loadCatalog(): CatalogIndex {
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
  return new CatalogIndex(parseCatalog(raw));
}

describe("registry discipline", () => {
  test("at least one handler is registered (sanity)", () => {
    expect(registry.size()).toBeGreaterThan(0);
  });

  test("every registered handler has a matching catalog entry", () => {
    const catalog = loadCatalog();
    const missing: string[] = [];
    for (const reg of registry.entries()) {
      if (catalog.find(reg.name) === null) missing.push(reg.name);
    }
    if (missing.length > 0) {
      console.log("handlers without catalog entries:", missing);
    }
    expect(missing).toEqual([]);
  });

  test("every registered handler's catalog entry is isComplete()", () => {
    const catalog = loadCatalog();
    const incomplete: string[] = [];
    for (const reg of registry.entries()) {
      const entry = catalog.find(reg.name);
      if (entry && !isComplete(entry)) incomplete.push(reg.name);
    }
    if (incomplete.length > 0) {
      console.log("handlers with incomplete catalog entries:", incomplete);
    }
    expect(incomplete).toEqual([]);
  });

  test("no duplicate registrations", () => {
    const names = new Set<string>();
    for (const reg of registry.entries()) {
      expect(names.has(reg.name)).toBe(false);
      names.add(reg.name);
    }
  });

  test("retired prefixed compatibility names are not registered", () => {
    expect(
      registry.entries().filter((reg) => reg.name.startsWith("risu_")),
    ).toEqual([]);
  });
});
