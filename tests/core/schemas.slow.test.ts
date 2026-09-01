import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeRisum } from "../../src/core/risum/codec.js";
import { parseRisuModule } from "../../src/core/schemas/parse.js";
import { loreBookSchema } from "../../src/core/schemas/lorebook.js";
import { customscriptSchema } from "../../src/core/schemas/customscript.js";
import {
  triggerscriptSchema,
  ALL_KNOWN_EFFECT_TYPES,
} from "../../src/core/schemas/triggerscript.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "local_library", "derived", "risum");
const listFixtures = (): string[] =>
  existsSync(FIXTURES_DIR)
    ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".risum")).map((f) => join(FIXTURES_DIR, f))
    : [];

describe("schemas — synthetic", () => {
  test("loreBook accepts minimal valid entry", () => {
    const r = loreBookSchema.safeParse({
      key: "foo", secondkey: "", insertorder: 0, comment: "",
      content: "bar", mode: "normal", alwaysActive: false, selective: false,
    });
    expect(r.success).toBe(true);
  });

  test("loreBook preserves unknown fields via passthrough", () => {
    const r = loreBookSchema.parse({
      key: "k", secondkey: "", insertorder: 0, comment: "",
      content: "c", mode: "normal", alwaysActive: false, selective: false,
      vendorSpecific: { x: 1 },
    });
    expect((r as Record<string, unknown>)["vendorSpecific"]).toEqual({ x: 1 });
  });

  test("loreBook rejects unknown mode (strict enum)", () => {
    const r = loreBookSchema.safeParse({
      key: "", secondkey: "", insertorder: 0, comment: "", content: "",
      mode: "bogus", alwaysActive: false, selective: false,
    });
    expect(r.success).toBe(false);
  });

  test("loreBook preserves intentionally-misspelled `extentions`", () => {
    const r = loreBookSchema.parse({
      key: "", secondkey: "", insertorder: 0, comment: "", content: "",
      mode: "normal", alwaysActive: false, selective: false,
      extentions: { risu_case_sensitive: true, other: "x" },
    });
    expect(r.extentions).toEqual({ risu_case_sensitive: true, other: "x" });
  });

  test("customscript accepts novel phase names (type is string)", () => {
    const r = customscriptSchema.safeParse({
      comment: "", in: "", out: "", type: "some_future_phase",
    });
    expect(r.success).toBe(true);
  });

  test("triggerscript default conditions/effect arrays", () => {
    const r = triggerscriptSchema.parse({
      comment: "", type: "output",
    });
    expect(r.conditions).toEqual([]);
    expect(r.effect).toEqual([]);
  });

  test("triggerscript rejects unknown binding type", () => {
    const r = triggerscriptSchema.safeParse({
      comment: "", type: "bogus_binding", conditions: [], effect: [],
    });
    expect(r.success).toBe(false);
  });

  test("triggerscript effect is lenient — accepts unknown opcode", () => {
    const r = triggerscriptSchema.parse({
      comment: "", type: "output",
      effect: [{ type: "v2TotallyNewOpcode", foo: "bar" }],
    });
    expect(r.effect[0]).toEqual({ type: "v2TotallyNewOpcode", foo: "bar" });
  });

  test("parseRisuModule isolates bad entries (per-entity fault isolation)", () => {
    const res = parseRisuModule({
      name: "x", description: "d", id: "i",
      lorebook: [
        // valid
        { key: "a", secondkey: "", insertorder: 1, comment: "", content: "c",
          mode: "normal", alwaysActive: false, selective: false },
        // invalid (mode is wrong)
        { key: "b", mode: "bogus" },
        // valid
        { key: "c", secondkey: "", insertorder: 3, comment: "", content: "c",
          mode: "constant", alwaysActive: true, selective: false },
      ],
    });
    expect(res.module.lorebook!.length).toBe(2);
    expect(res.issues.length).toBe(1);
    expect(res.issues[0]!.path).toEqual(["lorebook", "[1]"]);
  });

  test("parseRisuModule rejects top-level missing required fields", () => {
    expect(() => parseRisuModule({ name: "x" })).toThrow(/missing required/);
  });

  test("parseRisuModule rejects non-objects", () => {
    expect(() => parseRisuModule(null)).toThrow(/not_module|not an object/);
    expect(() => parseRisuModule([])).toThrow(/not_module|not an object/);
    expect(() => parseRisuModule(42)).toThrow(/not_module|not an object/);
  });
});

describe("schemas — corpus", () => {
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    test.skip("no fixtures present — run tests/setup/extract-fixtures.ts", () => {});
    return;
  }

  // Aggregate stats across the corpus. These let us size M12 (per-opcode
  // emitters) from real data, and they catch drift if the corpus ever gains
  // a card using an unknown opcode.
  interface CorpusStats {
    modulesParsed: number;
    modulesWithIssues: number;
    totalIssues: number;
    totalLorebookEntries: number;
    totalRegexScripts: number;
    totalTriggers: number;
    totalEffects: number;
    regexPhases: Record<string, number>;
    loreBookModes: Record<string, number>;
    triggerBindings: Record<string, number>;
    effectTypes: Record<string, number>;
    unknownEffectTypes: Record<string, number>;
  }
  const stats: CorpusStats = {
    modulesParsed: 0,
    modulesWithIssues: 0,
    totalIssues: 0,
    totalLorebookEntries: 0,
    totalRegexScripts: 0,
    totalTriggers: 0,
    totalEffects: 0,
    regexPhases: {},
    loreBookModes: {},
    triggerBindings: {},
    effectTypes: {},
    unknownEffectTypes: {},
  };
  const failures: { file: string; error: string }[] = [];

  // Run once — subsequent tests just assert on the collected stats.
  for (const path of fixtures) {
    const name = path.split(/[\\/]/).pop()!;
    try {
      const env = decodeRisum(new Uint8Array(readFileSync(path)));
      const res = parseRisuModule(env.module);
      stats.modulesParsed++;
      if (res.issues.length > 0) {
        stats.modulesWithIssues++;
        stats.totalIssues += res.issues.length;
      }
      const bump = (bucket: Record<string, number>, key: string) => {
        bucket[key] = (bucket[key] ?? 0) + 1;
      };
      if (res.module.lorebook) {
        stats.totalLorebookEntries += res.module.lorebook.length;
        for (const e of res.module.lorebook) bump(stats.loreBookModes, String(e.mode ?? ""));
      }
      if (res.module.regex) {
        stats.totalRegexScripts += res.module.regex.length;
        for (const r of res.module.regex) bump(stats.regexPhases, String(r.type ?? ""));
      }
      if (res.module.trigger) {
        stats.totalTriggers += res.module.trigger.length;
        for (const t of res.module.trigger) {
          bump(stats.triggerBindings, String(t.type ?? ""));
          const effects = t.effect ?? [];
          for (const eff of effects) {
            stats.totalEffects++;
            bump(stats.effectTypes, eff.type);
            if (!ALL_KNOWN_EFFECT_TYPES.has(eff.type)) bump(stats.unknownEffectTypes, eff.type);
          }
        }
      }
    } catch (e) {
      failures.push({ file: name, error: (e as Error).message });
    }
  }

  test("every corpus module parses at the top level", () => {
    if (failures.length > 0) {
      console.log(`[corpus] top-level failures:`, failures.slice(0, 10));
    }
    expect(failures.length).toBe(0);
  });

  test("reports corpus statistics", () => {
    // Print stats — observed once when the test runs.
    const header = (s: string) => console.log(`\n[corpus] ${s}`);
    header(`modules:         ${stats.modulesParsed} parsed, ${stats.modulesWithIssues} with per-entry issues (${stats.totalIssues} total)`);
    header(`lorebook:        ${stats.totalLorebookEntries} entries, modes=${JSON.stringify(stats.loreBookModes)}`);
    header(`regex:           ${stats.totalRegexScripts} scripts, phases=${JSON.stringify(stats.regexPhases)}`);
    header(`trigger:         ${stats.totalTriggers} triggers, bindings=${JSON.stringify(stats.triggerBindings)}`);
    header(`effects:         ${stats.totalEffects} total`);
    const effSorted = Object.entries(stats.effectTypes).sort((a, b) => b[1] - a[1]);
    console.log(`[corpus] top 30 effect types:`);
    for (const [t, n] of effSorted.slice(0, 30)) console.log(`  ${n.toString().padStart(6)}  ${t}`);
    if (Object.keys(stats.unknownEffectTypes).length > 0) {
      console.log(`[corpus] UNKNOWN effect types (not in ALL_KNOWN_EFFECT_TYPES):`);
      for (const [t, n] of Object.entries(stats.unknownEffectTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${n.toString().padStart(6)}  ${t}`);
      }
    }
    expect(stats.modulesParsed).toBeGreaterThan(0);
  });

  test("no unknown trigger effect types in corpus", () => {
    // This guard fails only if we encounter an opcode Risu emits that we
    // didn't enumerate in KNOWN_V1_EFFECTS/V2_OPCODES/CODE_EFFECTS. When it
    // trips, update the constant — the corpus is telling us something new.
    const unknown = Object.keys(stats.unknownEffectTypes);
    if (unknown.length > 0) {
      console.warn(`corpus introduced ${unknown.length} unknown effect type(s): ${unknown.join(", ")}`);
    }
    expect(unknown.length).toBe(0);
  });
});
