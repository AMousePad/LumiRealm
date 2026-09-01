import { describe, test, expect } from "bun:test";
import { listLibraryCards } from "../helpers/local-library.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { translateCharx } from "../../src/core/pipeline/translate.js";
import { TranslationError } from "../../src/core/errors.js";
import { zipSync, strToU8 } from "fflate";

const listCharxs = (): string[] => listLibraryCards();

let uuidCounter = 0;
const fakeUuid = () => `uuid-${++uuidCounter}`;
const fakeNow = () => 1_700_000_000_000;

/** Build a minimal .charx (ZIP only, no module) with the given card.json. */
function makeCharx(card: object, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "card.json": strToU8(JSON.stringify(card)),
    ...extra,
  });
}

describe("translateCharx — minimal synthetic inputs", () => {
  test("bare v3 card with no module → character only, no world book", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { name: "Alice", description: "desc" },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.character.name).toBe("Alice");
    expect(bundle.worldBook).toBeNull();
    expect(bundle.worldBookEntries).toEqual([]);
    expect(bundle.manifest.counts.lorebook_entries).toBe(0);
    expect(bundle.manifest.untranslated.macros_in_text).toBe(false);
  });

  test("card with character_book entries → world book created", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Bob",
        character_book: {
          entries: [
            { keys: ["greeting", "hi"], content: "Hello!", insertion_order: 10, comment: "greet", constant: false, selective: true },
            { keys: ["bye"], content: "Goodbye.", insertion_order: 20, constant: true },
          ],
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.worldBook).not.toBeNull();
    expect(bundle.worldBookEntries.length).toBe(2);
    expect(bundle.worldBookEntries[0]!.key).toEqual(["greeting", "hi"]);
    expect(bundle.worldBookEntries[0]!.content).toBe("Hello!");
    expect(bundle.worldBookEntries[0]!.order_value).toBe(10);
    expect(bundle.worldBookEntries[1]!.constant).toBe(true);
    expect(bundle.worldBook!.name).toContain("Bob");
  });

  test("macros in text flagged in manifest", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { name: "Cara", description: "Hi {{user}}, I'm {{char}}." },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.manifest.untranslated.macros_in_text).toBe(true);
  });

  test("char-level risuai.backgroundHTML translates to a trigger (not untranslated)", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "D",
        extensions: { risuai: { backgroundHTML: "<style>.x{}</style>" } },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    // Since M-session5 the BG-HTML is emitted as a Lumiscript trigger.
    expect(bundle.manifest.untranslated.background_html).toBe(false);
    const bg = bundle.scripts.find((s) => s.name === "risu-bg-html");
    expect(bg).toBeDefined();
    expect(bg!.triggers).toEqual(["CHAT_CHANGED", "ls:startup"]);
  });

  test("walking-skeleton mode skips BG-HTML emission so count lands in untranslated", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "D2",
        extensions: { risuai: { backgroundHTML: "<style>.x{}</style>" } },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow, mode: "walking-skeleton" });
    expect(bundle.manifest.untranslated.background_html).toBe(true);
  });

  test("missing card.json throws", () => {
    const empty = zipSync({ "other.txt": strToU8("x") });
    expect(() => translateCharx(empty, { uuid: fakeUuid, now: fakeNow })).toThrow(TranslationError);
  });

  test("card missing name throws", () => {
    const bad = makeCharx({ spec: "chara_card_v3", data: {} });
    expect(() => translateCharx(bad, { uuid: fakeUuid, now: fakeNow })).toThrow(TranslationError);
  });

  test("binary assets preserved in bundle", () => {
    uuidCounter = 0;
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const charx = makeCharx(
      { spec: "chara_card_v3", spec_version: "3.0", data: { name: "E" } },
      { "assets/icon/main.png": imgBytes },
    );
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.assets.get("assets/icon/main.png")).toEqual(imgBytes);
    expect(bundle.manifest.counts.assets).toBe(1);
  });

  test("includeAssets=false drops binary assets but tallies nothing", () => {
    const imgBytes = new Uint8Array([1, 2, 3]);
    const charx = makeCharx(
      { spec: "chara_card_v3", spec_version: "3.0", data: { name: "F" } },
      { "assets/x.bin": imgBytes },
    );
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow, includeAssets: false });
    expect(bundle.assets.size).toBe(0);
    expect(bundle.manifest.counts.assets).toBe(0);
  });
});

describe("translateCharx — raw CBS preservation", () => {
  test("preserves leaf and structural macro syntax verbatim", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "G",
        description:
          "Pick one: {{random::a,b,c}}. " +
          "{{#when::$mood::is::happy}}smile{{:else}}frown{{/when}}",
        first_mes: "Hello {{user}}!",
      },
    });
    const bundle = translateCharx(charx, {
      uuid: fakeUuid,
      now: fakeNow,
      mode: "full",
    });
    expect(bundle.character.description).toBe(
      "Pick one: {{random::a,b,c}}. " +
      "{{#when::$mood::is::happy}}smile{{:else}}frown{{/when}}",
    );
    expect(bundle.character.first_mes).toBe("Hello {{user}}!");
  });
});

// ─── M10 / M11 / M14 integration ──────────────────────────────────────────

describe("translateCharx — M10/M11/M14 wiring", () => {
  test("char-level regex flows into bundle.regexScripts", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "RegexOne",
        extensions: {
          risuai: {
            customScripts: [
              { comment: "normalize", in: "foo", out: "bar", type: "editoutput" },
              { comment: "disp", in: "baz", out: "qux", type: "editdisplay" },
            ],
          },
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.regexScripts.length).toBe(2);
    const placements = bundle.regexScripts.map((r) => r.target);
    expect(placements).toContain("response");
    expect(placements).toContain("display");
    expect(bundle.manifest.untranslated.character_level_regex).toBe(0);
  });

  test("@@action regex routes to bundle.scripts (M11)", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "EmoDriven",
        extensions: {
          risuai: {
            customScripts: [
              { comment: "happy face", in: "\\*smile\\*", out: "@@emo happy", type: "editoutput" },
            ],
          },
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.regexScripts.length).toBe(0);
    const triggers = bundle.scripts.filter((s) => s.type === "trigger");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.path).toContain("at-actions/");
    expect(bundle.manifest.untranslated.at_actions).toBe(1);
  });

  test("char-level triggers compile to scripts/triggers/*.js (M14)", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Triggerish",
        extensions: {
          risuai: {
            triggerscript: [
              {
                comment: "greet hook",
                type: "input",
                conditions: [],
                effect: [
                  { type: "setvar", var: "seen", operator: "=", value: "1" },
                ],
              },
            ],
          },
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    const triggers = bundle.scripts.filter((s) => s.type === "trigger");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.path).toContain("triggers/");
    expect(triggers[0]!.triggers).toEqual(["MESSAGE_SENT"]);
    expect(triggers[0]!.code).toContain("setvarV1");
    expect(triggers[0]!.code).toContain('script.require("risu-compat")');
  });

  test("untranslated counts decrement by translated totals", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Mixed",
        extensions: {
          risuai: {
            customScripts: [
              { comment: "a", in: "x", out: "y", type: "editoutput" },
              { comment: "b", in: "x", out: "@@emo happy", type: "editoutput" },
            ],
            triggerscript: [
              {
                comment: "t1",
                type: "display",
                conditions: [],
                effect: [{ type: "v2SetVar", var: "x", value: "1", valueType: "value", operator: "=", indent: 0 }],
              },
            ],
          },
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    // 2 regex scripts → 1 regex row + 1 skipped → all accounted for, so untranslated=0.
    expect(bundle.manifest.untranslated.character_level_regex).toBe(0);
    // 1 trigger compiled, so untranslated=0.
    expect(bundle.manifest.untranslated.character_level_triggers).toBe(0);
  });

  test("unknown regex phase tallied under regex_unknown_types", () => {
    uuidCounter = 0;
    const charx = makeCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Fuzzy",
        extensions: {
          risuai: {
            customScripts: [{ comment: "", in: "x", out: "y", type: "weird_phase" }],
          },
        },
      },
    });
    const bundle = translateCharx(charx, { uuid: fakeUuid, now: fakeNow });
    expect(bundle.manifest.untranslated.regex_unknown_types).toBe(1);
    // Row still emitted, just disabled.
    expect(bundle.regexScripts[0]!.disabled).toBe(true);
  });
});

// ─── corpus sweep ──────────────────────────────────────────────────────────

describe("translateCharx — corpus", () => {
  const charxs = listCharxs();
  if (charxs.length === 0) {
    test.skip("no corpus", () => {});
    return;
  }

  interface Stats {
    total: number;
    translated: number;
    withWorldBook: number;
    totalLorebookEntries: number;
    totalAssets: number;
    // Corpus composition (present in the input, regardless of translation success).
    // Read from post-Step-3 bundle fields, NOT from `manifest.untranslated.*`
    // (those are residuals and go to 0 as soon as M14 ships).
    withMacrosInText: number;
    withBackgroundHtml: number;
    withBackgroundEmbedding: number;
    withModuleCjs: number;
    withVirtualscript: number;
    withUtilityBot: number;
    withDefaultVariables: number;
    totalTriggers: number;
    totalLuaTriggers: number;
    totalAtActions: number;
    totalRegexRows: number;
    // Translation residuals — what the translator couldn't handle. Expected 0
    // for well-covered surfaces; >0 here means something regressed.
    untranslatedModuleRegex: number;
    untranslatedModuleTriggers: number;
    untranslatedCharLevelRegex: number;
    untranslatedCharLevelTriggers: number;
    failures: { file: string; message: string }[];
  }
  const stats: Stats = {
    total: 0, translated: 0,
    withWorldBook: 0, totalLorebookEntries: 0, totalAssets: 0,
    withMacrosInText: 0, withBackgroundHtml: 0, withBackgroundEmbedding: 0,
    withModuleCjs: 0, withVirtualscript: 0, withUtilityBot: 0,
    withDefaultVariables: 0,
    totalTriggers: 0, totalLuaTriggers: 0, totalAtActions: 0, totalRegexRows: 0,
    untranslatedModuleRegex: 0, untranslatedModuleTriggers: 0,
    untranslatedCharLevelRegex: 0, untranslatedCharLevelTriggers: 0,
    failures: [],
  };

  for (const path of charxs) {
    const name = path.split(/[\\/]/).pop()!;
    stats.total++;
    try {
      const bundle = translateCharx(new Uint8Array(readFileSync(path)), { sourceId: `file:${name}` });
      stats.translated++;
      if (bundle.worldBook) stats.withWorldBook++;
      stats.totalLorebookEntries += bundle.worldBookEntries.length;
      stats.totalAssets += bundle.manifest.counts.assets;
      if (bundle.manifest.untranslated.macros_in_text) stats.withMacrosInText++;
      if (bundle.manifest.untranslated.background_embedding) stats.withBackgroundEmbedding++;
      if (bundle.manifest.untranslated.module_cjs) stats.withModuleCjs++;
      // Residuals — sane to watch for regressions, not for composition.
      stats.untranslatedModuleRegex += bundle.manifest.untranslated.module_regex;
      stats.untranslatedModuleTriggers += bundle.manifest.untranslated.module_triggers;
      stats.untranslatedCharLevelRegex += bundle.manifest.untranslated.character_level_regex;
      stats.untranslatedCharLevelTriggers += bundle.manifest.untranslated.character_level_triggers;
      // Actual corpus composition — read from the Step-3 payload + the
      // already-emitted bundle fields. These are what's IN the corpus.
      stats.totalRegexRows += bundle.regexScripts.length;
      const p = bundle.risuPayload;
      if (p) {
        stats.totalTriggers += p.triggers.length;
        stats.totalLuaTriggers += p.lua_scripts.filter((s) => s.length > 0).length;
        stats.totalAtActions += p.at_actions.length;
        if (p.background_html && p.background_html.length > 0) stats.withBackgroundHtml++;
        if (p.virtualscript && p.virtualscript.length > 0) stats.withVirtualscript++;
        if (p.utility_bot) stats.withUtilityBot++;
        if (Object.keys(p.scriptstate_defaults).length > 0) stats.withDefaultVariables++;
      }
    } catch (e) {
      stats.failures.push({ file: name, message: (e as Error).message });
    }
  }

  test("every corpus card translates without hard failure", () => {
    if (stats.failures.length > 0) {
      console.log("[pipeline] failures:", stats.failures.slice(0, 10));
    }
    expect(stats.failures.length).toBe(0);
    expect(stats.translated).toBe(stats.total);
  });

  test("reports corpus pipeline stats", () => {
    console.log(`\n[pipeline corpus] ${stats.total} cards, ${stats.translated} translated`);
    console.log(`  with world book:             ${stats.withWorldBook}`);
    console.log(`  total lorebook entries:      ${stats.totalLorebookEntries}`);
    console.log(`  total assets:                ${stats.totalAssets}`);
    console.log(`  with macros in text:         ${stats.withMacrosInText}`);
    console.log(`  [composition — read from bundle.risuPayload + bundle.regexScripts]`);
    console.log(`  with backgroundHTML:         ${stats.withBackgroundHtml}`);
    console.log(`  with backgroundEmbedding:    ${stats.withBackgroundEmbedding}`);
    console.log(`  with module cjs:             ${stats.withModuleCjs}`);
    console.log(`  with virtualscript:          ${stats.withVirtualscript}   (stripped on .charx export)`);
    console.log(`  with utilityBot:             ${stats.withUtilityBot}`);
    console.log(`  with defaultVariables:       ${stats.withDefaultVariables}`);
    console.log(`  total triggers:              ${stats.totalTriggers}`);
    console.log(`  of which have Lua:           ${stats.totalLuaTriggers}`);
    console.log(`  total @@actions:             ${stats.totalAtActions}`);
    console.log(`  total regex rows:            ${stats.totalRegexRows}`);
    console.log(`  [residuals — should stay 0 unless a translator surface regresses]`);
    console.log(`  untranslated module regex:   ${stats.untranslatedModuleRegex}`);
    console.log(`  untranslated module triggers:${stats.untranslatedModuleTriggers}`);
    console.log(`  untranslated char-lvl regex: ${stats.untranslatedCharLevelRegex}`);
    console.log(`  untranslated char-lvl triggers:${stats.untranslatedCharLevelTriggers}`);
    expect(stats.total).toBeGreaterThan(0);
    // Regression guard: the four surfaces M14 is expected to translate cleanly.
    // Trigger side should stay at 0; regex has a known pre-existing residual
    // from module.regex rows whose `type` value isn't in the phase map (they
    // get surfaced via mapper issues, not translated). Cap at current level
    // so a new drop would fail the test.
    expect(stats.untranslatedModuleTriggers).toBe(0);
    expect(stats.untranslatedCharLevelRegex).toBe(0);
    expect(stats.untranslatedCharLevelTriggers).toBe(0);
    expect(stats.untranslatedModuleRegex).toBeLessThanOrEqual(400);
  });
});
