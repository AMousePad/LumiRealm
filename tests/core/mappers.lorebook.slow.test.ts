import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { splitKeywords } from "../../src/core/mappers/util.js";
import { mapLoreBook, mapLoreBookEntry } from "../../src/core/mappers/lorebook.js";
import { loreBookSchema, type LoreBook } from "../../src/core/schemas/lorebook.js";
import { decodeRisum } from "../../src/core/risum/codec.js";
import { parseRisuModule } from "../../src/core/schemas/parse.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "local_library", "derived", "risum");
const listFixtures = (): string[] =>
  existsSync(FIXTURES_DIR)
    ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".risum")).map((f) => join(FIXTURES_DIR, f))
    : [];

// Deterministic test doubles for id/time.
let uuidCounter = 0;
const fakeUuid = () => `uuid-${++uuidCounter}`;
const fakeNow = () => 1_700_000_000_000;

function parseLoreBook(raw: unknown): LoreBook {
  return loreBookSchema.parse(raw);
}

describe("splitKeywords", () => {
  test("empty / null / undefined → []", () => {
    expect(splitKeywords("")).toEqual([]);
    expect(splitKeywords(null)).toEqual([]);
    expect(splitKeywords(undefined)).toEqual([]);
  });
  test("comma-delimited", () => {
    expect(splitKeywords("a,b,c")).toEqual(["a", "b", "c"]);
  });
  test("semicolon-delimited", () => {
    expect(splitKeywords("a;b;c")).toEqual(["a", "b", "c"]);
  });
  test("mixed delimiters", () => {
    expect(splitKeywords("a,b;c,d")).toEqual(["a", "b", "c", "d"]);
  });
  test("whitespace trimmed, empty segments dropped", () => {
    expect(splitKeywords("  a ,, b ; ,  c  ")).toEqual(["a", "b", "c"]);
  });
  test("unicode kept as-is (no NFKC, no case fold)", () => {
    expect(splitKeywords("캐릭터,한자,日本語")).toEqual(["캐릭터", "한자", "日本語"]);
  });
});

describe("mapLoreBookEntry — field mapping", () => {
  const baseEntry: LoreBook = {
    key: "apple,banana",
    secondkey: "fruit",
    insertorder: 200,
    comment: "test entry",
    content: "This is the lore.",
    mode: "normal",
    alwaysActive: false,
    selective: true,
  } as LoreBook;

  test("all canonical fields map 1:1 with expected defaults", () => {
    uuidCounter = 0;
    const out = mapLoreBookEntry(baseEntry, "wb-1", new Map(), fakeNow(), fakeUuid);
    expect(out.id).toBe("uuid-1");
    expect(out.uid).toBe("uuid-2"); // no Risu id, new one generated
    expect(out.world_book_id).toBe("wb-1");
    expect(out.key).toEqual(["apple", "banana"]);
    expect(out.keysecondary).toEqual(["fruit"]);
    expect(out.content).toBe("This is the lore.");
    expect(out.comment).toBe("test entry");
    expect(out.order_value).toBe(200);
    expect(out.selective).toBe(true);
    expect(out.constant).toBe(false);
    expect(out.disabled).toBe(false);
    expect(out.probability).toBe(100);
    expect(out.use_probability).toBe(false);
    expect(out.case_sensitive).toBe(false);
    expect(out.match_whole_words).toBe(false);
    expect(out.use_regex).toBe(false);
    expect(out.created_at).toBe(fakeNow());
    expect(out.updated_at).toBe(fakeNow());
    expect(out.vectorized).toBe(false);
    expect(out.vector_index_status).toBe("not_enabled");
    expect(out.role).toBeNull();
    expect(out.position).toBe(0);
    expect(out.depth).toBe(0);
  });

  test("mode='constant' → constant=true, disabled=false", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, mode: "constant" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.constant).toBe(true);
    expect(out.disabled).toBe(false);
  });

  test("alwaysActive=true → constant=true (regardless of mode)", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, alwaysActive: true }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.constant).toBe(true);
  });

  test("mode='folder' → disabled=true, constant=false", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, mode: "folder", comment: "My Folder" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.disabled).toBe(true);
    expect(out.constant).toBe(false);
  });

  test("activationPercent present → probability passed through + use_probability=true", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, activationPercent: 42 }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.probability).toBe(42);
    expect(out.use_probability).toBe(true);
  });

  test("activationPercent=null (observed in corpus) → probability=100, use_probability=false", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, activationPercent: null }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.probability).toBe(100);
    expect(out.use_probability).toBe(false);
  });

  test("@@probability decorator → probability + use_probability=true (Risu parity for the dice roll)", () => {
    // Without use_probability=true, Lumi's world-info-activation.service.ts:502
    // skips the dice roll entirely — the entry always activates regardless
    // of the field. Risu (lorebook.svelte.ts:487-491) ALWAYS rolls when
    // @@probability is present, so we must flip the flag.
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, content: "@@probability 25\nbody" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.probability).toBe(25);
    expect(out.use_probability).toBe(true);
    expect(out.content).toBe("body");
  });

  test("@@end decorator → position=4, depth=0 (Risu lorebook.svelte.ts:301-305)", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, content: "@@end\nbody" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.position).toBe(4);
    expect(out.depth).toBe(0);
    expect(out.content).toBe("body");
  });

  test("case_sensitive picked up from extentions.risu_case_sensitive", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, extentions: { risu_case_sensitive: true } }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.case_sensitive).toBe(true);
  });

  test("useRegex passes through", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, useRegex: true }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.use_regex).toBe(true);
  });

  test("Risu-specific fields preserved in extensions", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({
        ...baseEntry,
        bookVersion: 2,
        id: "risu-id-123",
        folder: "folder:abc",
        extentions: { risu_case_sensitive: false },
      }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.extensions["risu_mode"]).toBe("normal");
    expect(out.extensions["risu_book_version"]).toBe(2);
    expect(out.extensions["risu_entry_id"]).toBe("risu-id-123");
    expect(out.extensions["risu_folder"]).toBe("folder:abc");
    expect(out.extensions["risu_extentions"]).toEqual({ risu_case_sensitive: false });
  });

  test("decorators at the top of content are parsed + mapped + stripped from content", () => {
    // Integration test for the lorebook-decorators wiring: decorators
    // listed at the top of `content` should:
    //   1. Map to Lumi-native entry fields (Tier 1).
    //   2. Be stripped from the entry's `content` body.
    //   3. Stash unmapped (Tier 2/3) decorators on extensions._risu_decorators.
    const out = mapLoreBookEntry(
      parseLoreBook({
        ...baseEntry,
        key: "apple",
        content:
          "@@position after_desc\n" +
          "@@role assistant\n" +
          "@@additional_keys cherry, durian\n" +
          "@@is_greeting 0\n" +
          "actual entry body here\nsecond line",
      }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.position).toBe(1); // after_desc
    expect(out.role).toBe("assistant");
    expect(out.key).toEqual(["apple", "cherry", "durian"]);
    expect(out.content).toBe("actual entry body here\nsecond line");
    // Tier 2 stash for the future runtime intercept.
    const stashed = out.extensions["_risu_decorators"] as Array<{ name: string; args: string[] }>;
    expect(stashed).toBeDefined();
    expect(stashed.some((d) => d.name === "is_greeting" && d.args[0] === "0")).toBe(true);
  });

  test("entry with NO decorators leaves content + extensions untouched by decorator pass", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, content: "plain content, no @@ here\nmore lines" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.content).toBe("plain content, no @@ here\nmore lines");
    expect(out.extensions["_risu_decorators"]).toBeUndefined();
  });

  test("existing Risu id reused as uid", () => {
    const out = mapLoreBookEntry(
      parseLoreBook({ ...baseEntry, id: "risu-id-xyz" }),
      "wb", new Map(), fakeNow(), fakeUuid,
    );
    expect(out.uid).toBe("risu-id-xyz");
  });
});

describe("mapLoreBook — folder resolution", () => {
  test("child entries get group_name from their folder's comment", () => {
    const entries = [
      parseLoreBook({
        key: "", secondkey: "", insertorder: 0, comment: "Geography",
        content: "", mode: "folder", alwaysActive: false, selective: false,
        id: "folder-abc",
      }),
      parseLoreBook({
        key: "paris", secondkey: "", insertorder: 10, comment: "Paris",
        content: "French capital.", mode: "normal", alwaysActive: false, selective: false,
        folder: "folder:folder-abc",
      }),
    ];
    const mapped = mapLoreBook(entries, { worldBookId: "wb", uuid: fakeUuid, now: fakeNow });
    expect(mapped[0]!.disabled).toBe(true);
    expect(mapped[0]!.group_name).toBe(""); // folder's own group_name is not itself
    expect(mapped[1]!.group_name).toBe("Geography");
    expect(mapped[1]!.disabled).toBe(false);
  });

  test("unresolvable folder ref → group_name stays empty (no crash)", () => {
    const entries = [
      parseLoreBook({
        key: "x", secondkey: "", insertorder: 0, comment: "orphan",
        content: "", mode: "normal", alwaysActive: false, selective: false,
        folder: "folder:does-not-exist",
      }),
    ];
    const mapped = mapLoreBook(entries, { worldBookId: "wb", uuid: fakeUuid, now: fakeNow });
    expect(mapped[0]!.group_name).toBe("");
  });
});

describe("mapLoreBook — corpus sweep", () => {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    test.skip("no corpus", () => {});
    return;
  }

  interface Stats {
    totalModules: number;
    totalEntries: number;
    mapped: number;
    failures: { file: string; index: number; message: string }[];
    positions: Record<number, number>;
    constantCount: number;
    disabledCount: number;
    useRegexCount: number;
    useProbabilityCount: number;
    withGroupName: number;
  }
  const stats: Stats = {
    totalModules: 0, totalEntries: 0, mapped: 0, failures: [],
    positions: {}, constantCount: 0, disabledCount: 0,
    useRegexCount: 0, useProbabilityCount: 0, withGroupName: 0,
  };

  for (const path of fixtures) {
    const name = path.split(/[\\/]/).pop()!;
    const env = decodeRisum(new Uint8Array(readFileSync(path)));
    const res = parseRisuModule(env.module);
    stats.totalModules++;
    if (!res.module.lorebook) continue;
    // Cast needed: Zod's passthrough input/output types differ slightly under
    // strict mode, but runtime values are compatible (parseRisuModule already
    // ran them through the schema).
    const mapped = mapLoreBook(res.module.lorebook as LoreBook[], { worldBookId: "wb" });
    for (let i = 0; i < mapped.length; i++) {
      stats.totalEntries++;
      const entry = mapped[i]!;
      // Every mapped entry must have: a non-empty id/uid/world_book_id, valid arrays,
      // non-negative numeric fields, and a stringly-typed extensions object.
      try {
        if (!entry.id) throw new Error("empty id");
        if (!entry.uid) throw new Error("empty uid");
        if (entry.world_book_id !== "wb") throw new Error("bad world_book_id");
        if (!Array.isArray(entry.key) || !Array.isArray(entry.keysecondary))
          throw new Error("key arrays missing");
        if (entry.probability < 0 || entry.probability > 100) throw new Error("bad probability");
        if (typeof entry.extensions !== "object") throw new Error("bad extensions");
        stats.mapped++;
        stats.positions[entry.position] = (stats.positions[entry.position] ?? 0) + 1;
        if (entry.constant) stats.constantCount++;
        if (entry.disabled) stats.disabledCount++;
        if (entry.use_regex) stats.useRegexCount++;
        if (entry.use_probability) stats.useProbabilityCount++;
        if (entry.group_name) stats.withGroupName++;
      } catch (e) {
        stats.failures.push({ file: name, index: i, message: (e as Error).message });
      }
    }
  }

  test("every corpus lorebook entry maps cleanly", () => {
    if (stats.failures.length > 0) {
      console.log("[lorebook mapper] failures (first 10):", stats.failures.slice(0, 10));
    }
    expect(stats.failures.length).toBe(0);
    expect(stats.mapped).toBe(stats.totalEntries);
  });

  test("reports corpus stats", () => {
    console.log(`\n[lorebook mapper corpus] modules=${stats.totalModules}, entries=${stats.totalEntries}, mapped=${stats.mapped}`);
    console.log(`  constant=${stats.constantCount}, disabled(folders)=${stats.disabledCount}`);
    console.log(`  use_regex=${stats.useRegexCount}, use_probability=${stats.useProbabilityCount}`);
    console.log(`  entries with group_name=${stats.withGroupName}`);
    console.log(`  position distribution=${JSON.stringify(stats.positions)}`);
    expect(stats.totalEntries).toBeGreaterThan(10_000);
  });
});
