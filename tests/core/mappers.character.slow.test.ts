import { describe, test, expect } from "bun:test";
import { listLibraryCards } from "../helpers/local-library.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mapCharacter } from "../../src/core/mappers/character.js";
import { readCharx } from "../../src/core/charx/reader.js";
import { TranslationError } from "../../src/core/errors.js";

const listCharxs = (): string[] => listLibraryCards();

let uuidCounter = 0;
const fakeUuid = () => `uuid-${++uuidCounter}`;
const fakeNow = () => 1_700_000_000_000;

const baseV3Card = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "Test Character",
    description: "A test description.",
    personality: "Friendly.",
    scenario: "Testing scenario.",
    first_mes: "Hello!",
    mes_example: "<START>\\n{{char}}: example\\n",
    creator: "Alice",
    creator_notes: "notes",
    system_prompt: "sp",
    post_history_instructions: "phi",
    alternate_greetings: ["hello", "hi"],
    tags: ["test"],
    character_version: "1.0.0",
    extensions: {
      depth_prompt: { depth: 0, prompt: "" },
      risuai: { backgroundHTML: "<style>.x{}</style>" },
    },
  },
};

describe("mapCharacter — spec dispatch", () => {
  test("v3 wrapped shape: fields mapped from data block", () => {
    uuidCounter = 0;
    const r = mapCharacter(baseV3Card, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.name).toBe("Test Character");
    expect(r.character.description).toBe("A test description.");
    expect(r.character.personality).toBe("Friendly.");
    expect(r.character.scenario).toBe("Testing scenario.");
    expect(r.character.first_mes).toBe("Hello!");
    expect(r.character.alternate_greetings).toEqual(["hello", "hi"]);
    expect(r.character.tags).toEqual(["test"]);
    expect(r.character.id).toBe("uuid-1");
    expect(r.character.created_at).toBe(fakeNow());
  });

  test("v1 flat shape: top-level fields used", () => {
    const flat = { name: "Flat Character", description: "flat" };
    const r = mapCharacter(flat, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.name).toBe("Flat Character");
    expect(r.character.description).toBe("flat");
    // v1 → translation note recorded
    const ext = r.character.extensions["_risu_to_lumi"] as { translation_notes: string[]; spec: string };
    expect(ext.spec).toBe("v1");
    expect(ext.translation_notes.some((n) => n.includes("v1"))).toBe(true);
  });

  test("v2 wrapped shape: data block used, note recorded", () => {
    const v2 = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "V2" } };
    const r = mapCharacter(v2, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.name).toBe("V2");
    const ext = r.character.extensions["_risu_to_lumi"] as { spec: string; translation_notes: string[] };
    expect(ext.spec).toBe("chara_card_v2");
    expect(ext.translation_notes.some((n) => n.includes("chara_card_v2"))).toBe(true);
  });
});

describe("mapCharacter — validation", () => {
  test("missing name throws", () => {
    expect(() => mapCharacter({ spec: "chara_card_v3", data: {} })).toThrow(TranslationError);
  });

  test("whitespace-only name throws", () => {
    expect(() => mapCharacter({ spec: "chara_card_v3", data: { name: "   " } })).toThrow(/missing_name|required/);
  });

  test("non-object input throws", () => {
    expect(() => mapCharacter(null)).toThrow(TranslationError);
    expect(() => mapCharacter([])).toThrow(TranslationError);
    expect(() => mapCharacter(42)).toThrow(TranslationError);
  });
});

describe("mapCharacter — extensions preserved", () => {
  test("risuai subtree preserved verbatim", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: {
        name: "X",
        extensions: {
          risuai: {
            backgroundHTML: "<style>.foo{}</style>",
            bias: [["tok", 1]],
            lowLevelAccess: true,
            virtualscript: "print('hi')",
            defaultVariables: "x=1\\ny=2",
          },
        },
      },
    }, { uuid: fakeUuid, now: fakeNow });
    const risuai = r.character.extensions["risuai"] as Record<string, unknown>;
    expect(risuai["backgroundHTML"]).toBe("<style>.foo{}</style>");
    expect(risuai["bias"]).toEqual([["tok", 1]]);
    expect(risuai["lowLevelAccess"]).toBe(true);
    expect(risuai["virtualscript"]).toBe("print('hi')");
  });

  test("character_book lifted into extensions (Lumiverse convention)", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: {
        name: "X",
        character_book: { entries: [{ keys: ["k"], content: "c" }] },
      },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.extensions["character_book"]).toEqual({ entries: [{ keys: ["k"], content: "c" }] });
    expect(r.extracted.characterBook).toEqual({ entries: [{ keys: ["k"], content: "c" }] });
  });

  test("character_version lifted into extensions", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "X", character_version: "2.1.3" },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.extensions["character_version"]).toBe("2.1.3");
  });

  test("nickname / group_only_greetings / creation_date preserved", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "X", nickname: "Xxx", group_only_greetings: ["hi"], creation_date: 12345 },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.extensions["nickname"]).toBe("Xxx");
    expect(r.character.extensions["group_only_greetings"]).toEqual(["hi"]);
    expect(r.character.extensions["ccv3_creation_date"]).toBe(12345);
  });

  test("provenance metadata attached", () => {
    const r = mapCharacter(baseV3Card, { uuid: fakeUuid, now: fakeNow, sourceId: "risurealm:abc" });
    const rtl = r.character.extensions["_risu_to_lumi"] as { source: string; spec: string; spec_version: string };
    expect(rtl.source).toBe("risurealm:abc");
    expect(rtl.spec).toBe("chara_card_v3");
    expect(rtl.spec_version).toBe("3.0");
  });
});

describe("mapCharacter — extracted downstream payloads", () => {
  test("backgroundHTML surfaced from risuai subtree", () => {
    const r = mapCharacter(baseV3Card, { uuid: fakeUuid, now: fakeNow });
    expect(r.extracted.backgroundHTML).toBe("<style>.x{}</style>");
  });

  test("char-level customScripts/triggerscript surfaced + issue flagged", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: {
        name: "X",
        extensions: {
          risuai: {
            customScripts: [{ in: "a", out: "b", type: "editoutput", comment: "c" }],
            triggerscript: [{ comment: "t", type: "output", conditions: [], effect: [] }],
          },
        },
      },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.extracted.customScripts.length).toBe(1);
    expect(r.extracted.triggerScripts.length).toBe(1);
    expect(r.issues.some((i) => i.path.includes("customScripts"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("triggerscript"))).toBe(true);
  });

  test("absent risuai subtree → extracted fields null/empty", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "X" },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.extracted.backgroundHTML).toBeNull();
    expect(r.extracted.customScripts).toEqual([]);
    expect(r.extracted.triggerScripts).toEqual([]);
    expect(r.extracted.virtualScript).toBeNull();
    expect(r.extracted.defaultVariables).toBeNull();
    expect(r.extracted.additionalText).toBeNull();
  });

  test("additionalText extracted + issue raised + extension preserved", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: {
        name: "X",
        extensions: {
          risuai: { additionalText: "para1\n\npara2\n\npara3" },
        },
      },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.extracted.additionalText).toBe("para1\n\npara2\n\npara3");
    // Issue surfaced for the importer.
    expect(
      r.issues.some((i) => i.path.includes("additionalText") && /not translated|memory cortex/i.test(i.message)),
    ).toBe(true);
    // Extension blob keeps the original value (round-trip preservation).
    const risuai = r.character.extensions["risuai"] as Record<string, unknown>;
    expect(risuai["additionalText"]).toBe("para1\n\npara2\n\npara3");
  });

  test("empty additionalText → no issue", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "X", extensions: { risuai: { additionalText: "" } } },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.extracted.additionalText).toBeNull();
    expect(r.issues.some((i) => i.path.includes("additionalText"))).toBe(false);
  });

  test("non-string defaults coerced: name coerced from number", () => {
    const r = mapCharacter({
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "Test", description: 42 as any },
    }, { uuid: fakeUuid, now: fakeNow });
    expect(r.character.description).toBe("42");
  });
});

// ─── corpus sweep ──────────────────────────────────────────────────────────

describe("mapCharacter — corpus", () => {
  const charxs = listCharxs();
  if (charxs.length === 0) {
    test.skip("no corpus", () => {});
    return;
  }

  interface Stats {
    total: number;
    mapped: number;
    withBackgroundHTML: number;
    withCharacterBook: number;
    withCharLevelRegex: number;
    withCharLevelTriggers: number;
    withVirtualScript: number;
    withDefaultVariables: number;
    withAssets: number;
    withDepthPrompt: number;
    withAdditionalText: number;
    specCounts: Record<string, number>;
    hardFailures: { file: string; message: string }[];
  }
  const stats: Stats = {
    total: 0, mapped: 0,
    withBackgroundHTML: 0, withCharacterBook: 0,
    withCharLevelRegex: 0, withCharLevelTriggers: 0,
    withVirtualScript: 0, withDefaultVariables: 0, withAssets: 0,
    withDepthPrompt: 0,
    withAdditionalText: 0,
    specCounts: {}, hardFailures: [],
  };

  for (const path of charxs) {
    const name = path.split(/[\\/]/).pop()!;
    stats.total++;
    try {
      const bundle = readCharx(new Uint8Array(readFileSync(path)), { decodeModule: false });
      const r = mapCharacter(bundle.card, { sourceId: `file:${name}` });
      stats.mapped++;
      const rtl = r.character.extensions["_risu_to_lumi"] as { spec: string };
      stats.specCounts[rtl.spec] = (stats.specCounts[rtl.spec] ?? 0) + 1;
      if (r.extracted.backgroundHTML) stats.withBackgroundHTML++;
      if (r.extracted.characterBook) stats.withCharacterBook++;
      if (r.extracted.customScripts.length > 0) stats.withCharLevelRegex++;
      if (r.extracted.triggerScripts.length > 0) stats.withCharLevelTriggers++;
      if (r.extracted.virtualScript) stats.withVirtualScript++;
      if (r.extracted.defaultVariables) stats.withDefaultVariables++;
      if (r.extracted.assets.length > 0) stats.withAssets++;
      if (r.extracted.depthPrompt) stats.withDepthPrompt++;
      if (r.extracted.additionalText) stats.withAdditionalText++;
    } catch (e) {
      stats.hardFailures.push({ file: name, message: (e as Error).message });
    }
  }

  test("every corpus card maps without hard failure", () => {
    if (stats.hardFailures.length > 0) {
      console.log("[character mapper] failures:", stats.hardFailures.slice(0, 10));
    }
    expect(stats.hardFailures.length).toBe(0);
    expect(stats.mapped).toBe(stats.total);
  });

  test("reports corpus character stats", () => {
    console.log(`\n[character mapper corpus] ${stats.total} cards, ${stats.mapped} mapped`);
    console.log(`  spec distribution:        ${JSON.stringify(stats.specCounts)}`);
    console.log(`  with backgroundHTML:      ${stats.withBackgroundHTML}`);
    console.log(`  with character_book:      ${stats.withCharacterBook}`);
    console.log(`  with char-level regex:    ${stats.withCharLevelRegex}`);
    console.log(`  with char-level triggers: ${stats.withCharLevelTriggers}`);
    console.log(`  with virtualscript (Lua): ${stats.withVirtualScript}`);
    console.log(`  with defaultVariables:    ${stats.withDefaultVariables}`);
    console.log(`  with CCSv3 assets:        ${stats.withAssets}`);
    console.log(`  with depth_prompt obj:    ${stats.withDepthPrompt}`);
    console.log(`  with additionalText:      ${stats.withAdditionalText}`);
    expect(stats.total).toBeGreaterThan(0);
  });
});
