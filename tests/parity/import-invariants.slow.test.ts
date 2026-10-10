/**
 * Cross-surface import-parity invariants. Walks the full corpus, translates
 * each card, and asserts that values that should agree across surfaces of
 * the import pipeline DO agree.
 *
 * The class of bug this catches: one part of the pipeline transforms a value
 * (lowercase, trim, parse, normalize) while a sibling part keeps the raw
 * shape, silently breaking macros that compare against the unmodified value.
 *
 * Canonical case: asset names lowercased in `asset_index` keys but
 * preserved-case in `risuPayload.additional_assets[].name`. Card authors
 * write `<img src=AssetName>` then check `{{equal::{{slot::X}}::AssetName.png}}`
 * against `{{assetlist}}`, which emits names verbatim from storage, so a
 * lowercased index breaks the equality check and silently falls back.
 *
 * Memory model: single-pass + immediate discard.
 *   The corpus has 1803 cards including some with 1500+ embedded image
 *   assets (~600MB decompressed for the largest). Holding 1803 × CharxBundle
 *   + 1803 × LumiBundle simultaneously OOMs the host. We walk the corpus
 *   ONCE at file-load, run every invariant inline per card, push results
 *   into module-level violation buckets, then drop the raw + bundle refs
 *   before the next iteration. Memory peak ≈ one card's full bundle
 *   (~1-2GB worst case). Each test() just reads its bucket.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { translateCharx } from "../../src/core/pipeline/translate.js";
import { readCharx, type CharxBundle } from "../../src/core/charx/reader.js";
import { buildAssetIndexes } from "../../src/payload/import.js";
import { parseScriptstateDefaults } from "../../src/core/pipeline/risu-payload.js";
import { extractGlobalFontDeclarations } from "../../src/core/mappers/font-hoist.js";
import type { LumiBundle } from "../../src/core/pipeline/types.js";
import { listLibraryCards } from "../helpers/local-library.js";

interface Violation {
  readonly card: string;
  readonly detail: string;
}

// Cards whose source `.charx` has exporter-side path mangling (a `\` in the
// card.json assets[].uri that the zip archiver substituted, typically to `_`)
// cannot pass the path-presence invariant, Risu-side data bug, not ours.
// List filenames in the optional `tests/local_library/known-malformed.txt`
// (one per line, `#` comments) to exempt them.
function loadKnownMalformedPaths(): ReadonlySet<string> {
  const file = join(import.meta.dir, "..", "local_library", "known-malformed.txt");
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  );
}
const KNOWN_MALFORMED_PATHS: ReadonlySet<string> = loadKnownMalformedPaths();

// Per-invariant buckets — populated during the single corpus pass below.
// One bucket per `test()` so each can assert isolated.
const violations = {
  assetNameCase: [] as Violation[],
  emotionNameCase: [] as Violation[],
  assetPathPresence: [] as Violation[],
  emotionPathPresence: [] as Violation[],
  bgHtmlRoundtrip: [] as Violation[],
  virtualscriptRoundtrip: [] as Violation[],
  utilityBot: [] as Violation[],
  scriptDefaults: [] as Violation[],
  luaLength: [] as Violation[],
  luaAlignment: [] as Violation[],
  charName: [] as Violation[],
  altGreetingsLength: [] as Violation[],
  tagsLength: [] as Violation[],
};
let analyzedCount = 0;
let totalCount = 0;
let translateFailureCount = 0;

function getRisuai(raw: CharxBundle): Record<string, unknown> {
  const data = (raw.card as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return {};
  const ext = data["extensions"] as Record<string, unknown> | undefined;
  const r = ext?.["risuai"];
  return (r && typeof r === "object" && !Array.isArray(r))
    ? (r as Record<string, unknown>)
    : {};
}

function getDataField<T = unknown>(raw: CharxBundle, key: string): T | undefined {
  const data = (raw.card as { data?: Record<string, unknown> } | null)?.data;
  return data?.[key] as T | undefined;
}

function reportFirstFew(label: string, list: readonly Violation[]): void {
  if (list.length === 0) return;
  console.log(`[invariant.${label}] ${list.length} card(s) violate, first 5:`);
  for (const v of list.slice(0, 5)) {
    console.log(`  ${v.card}: ${v.detail}`);
  }
}

/** Run every invariant against one card's analyses, pushing into the
 *  module-level violation buckets. Returns nothing — side-effect only. */
function runInvariants(cardName: string, raw: CharxBundle, bundle: LumiBundle): void {
  const payload = bundle.risuPayload;
  if (!payload) return;
  const risuai = getRisuai(raw);

  // 1. asset_index keys preserve author-case
  if (payload.additional_assets.length > 0) {
    const uploads: Record<string, string> = {};
    payload.additional_assets.forEach((a, i) => { uploads[a.path] = `img-${i}`; });
    const built = buildAssetIndexes(payload, uploads);
    const seen = new Set(Object.keys(built.assetIndex));
    for (const a of payload.additional_assets) {
      if (!seen.has(a.name)) {
        violations.assetNameCase.push({
          card: cardName,
          detail: `asset name ${JSON.stringify(a.name)} missing from index keys (would break card-author equal-checks against {{assetlist}})`,
        });
        break; // one report per card
      }
    }
  }

  // 2. emotion_index keys preserve author-case
  if (payload.emotion_images.length > 0) {
    const uploads: Record<string, string> = {};
    payload.emotion_images.forEach((a, i) => { uploads[a.path] = `img-${i}`; });
    const built = buildAssetIndexes(payload, uploads);
    const seen = new Set(Object.keys(built.emotionIndex));
    for (const a of payload.emotion_images) {
      if (!seen.has(a.name)) {
        violations.emotionNameCase.push({
          card: cardName,
          detail: `emotion name ${JSON.stringify(a.name)} missing from emotion_index keys`,
        });
        break;
      }
    }
  }

  // 3. additional_assets[].path always present in bundle.assets
  // Skip cards on the KNOWN_MALFORMED_PATHS allowlist — those have
  // exporter-side bugs in the source `.charx` (path mangled between
  // card.json URI and zip-stored path) and the divergence is real
  // but not actionable on our side. See KNOWN_MALFORMED_PATHS comment.
  if (!KNOWN_MALFORMED_PATHS.has(cardName)) {
    for (const a of payload.additional_assets) {
      if (!bundle.assets.has(a.path)) {
        violations.assetPathPresence.push({
          card: cardName,
          detail: `path ${JSON.stringify(a.path)} referenced in additional_assets[] but absent from bundle.assets`,
        });
        break;
      }
    }
  }

  // 4. emotion_images[].path always present in bundle.assets
  for (const a of payload.emotion_images) {
    if (!bundle.assets.has(a.path)) {
      violations.emotionPathPresence.push({
        card: cardName,
        detail: `path ${JSON.stringify(a.path)} referenced in emotion_images[] but absent from bundle.assets`,
      });
      break;
    }
  }

  // 5. background_html byte-roundtrip — but only on cards where the
  // pipeline does NOT intentionally rewrite bg-html. Two transformations
  // legitimately mutate it:
  //   (a) Font hoisting: @font-face / @import declarations from regex
  //       rules' replace_strings get prepended so browsers actually load
  //       the fonts.
  //   (b) SVG rasterization: inline <svg>...</svg> in bg-html gets
  //       swapped for <img data-lumirealm-svg-pending="N"> placeholders
  //       which the frontend canvas-rasterizes at import.
  // Either condition opts the card out of byte-equality; the rest still
  // catch any silent extract-time normalization.
  {
    const expected = typeof risuai["backgroundHTML"] === "string"
      ? (risuai["backgroundHTML"] as string)
      : null;
    const regexReplaceStrings = bundle.regexScripts.map((r) => r.replace_string ?? "");
    const hoistsFonts = extractGlobalFontDeclarations(regexReplaceStrings).length > 0;
    const hasInlineSvg = expected !== null && expected.indexOf("<svg") >= 0;
    const transformsBgHtml = hoistsFonts || hasInlineSvg;
    if (!transformsBgHtml && payload.background_html !== expected) {
      violations.bgHtmlRoundtrip.push({
        card: cardName,
        detail: `expected ${expected === null ? "null" : `${expected.length}-char string`}, got ${payload.background_html === null ? "null" : `${payload.background_html.length}-char string`}`,
      });
    }
  }

  // 6. virtualscript byte-roundtrip
  {
    const expected = typeof risuai["virtualscript"] === "string"
      ? (risuai["virtualscript"] as string)
      : null;
    if (payload.virtualscript !== expected) {
      violations.virtualscriptRoundtrip.push({
        card: cardName,
        detail: `expected ${expected === null ? "null" : `${expected.length}-char string`}, got ${payload.virtualscript === null ? "null" : `${payload.virtualscript.length}-char string`}`,
      });
    }
  }

  // 7. utility_bot truthy round-trip
  {
    const expected = risuai["utilityBot"] === true;
    if (payload.utility_bot !== expected) {
      violations.utilityBot.push({
        card: cardName,
        detail: `expected ${expected}, got ${payload.utility_bot}`,
      });
    }
  }

  // 8. scriptstate_defaults parse round-trip
  {
    const v = risuai["defaultVariables"];
    const rawText = typeof v === "string" ? v : null;
    const expected = parseScriptstateDefaults(rawText);
    const expKeys = Object.keys(expected).sort();
    const actKeys = Object.keys(payload.scriptstate_defaults).sort();
    let mismatch = expKeys.length !== actKeys.length;
    if (!mismatch) {
      for (let i = 0; i < expKeys.length; i++) {
        if (expKeys[i] !== actKeys[i] || expected[expKeys[i]!] !== payload.scriptstate_defaults[expKeys[i]!]) {
          mismatch = true;
          break;
        }
      }
    }
    if (mismatch) {
      violations.scriptDefaults.push({
        card: cardName,
        detail: `expected ${expKeys.length} keys, got ${actKeys.length}`,
      });
    }
  }

  // 9. lua_scripts.length === triggers.length
  if (payload.lua_scripts.length !== payload.triggers.length) {
    violations.luaLength.push({
      card: cardName,
      detail: `lua_scripts.length=${payload.lua_scripts.length} ≠ triggers.length=${payload.triggers.length}`,
    });
  }

  // 10. lua_scripts[i] non-empty iff triggers[i] has triggerlua effect
  // WITH non-empty `code`. Empty `code` is semantically a no-op trigger
  // (runLua("") does nothing) — extractLuaScripts in risu-payload.ts
  // correctly produces `lua_scripts[i] = ""` for that case, and we
  // mirror the same predicate here so the cross-surface check matches
  // what the runtime would actually execute.
  {
    const n = Math.min(payload.triggers.length, payload.lua_scripts.length);
    for (let i = 0; i < n; i++) {
      const trig = payload.triggers[i] as { effect?: Array<{ type?: string; code?: string }> };
      const hasNonEmptyLua = Array.isArray(trig.effect) && trig.effect.some(
        (e) => e?.type === "triggerlua" && typeof e.code === "string" && e.code.length > 0,
      );
      const luaSlot = payload.lua_scripts[i] ?? "";
      const luaPresent = luaSlot.length > 0;
      if (hasNonEmptyLua !== luaPresent) {
        violations.luaAlignment.push({
          card: cardName,
          detail: `trigger[${i}]: hasNonEmptyTriggerLua=${hasNonEmptyLua} but lua_scripts[${i}].length=${luaSlot.length}`,
        });
        break;
      }
    }
  }

  // 11. character.name verbatim
  {
    const expected = getDataField<string>(raw, "name");
    if (typeof expected === "string" && bundle.character.name !== expected) {
      violations.charName.push({
        card: cardName,
        detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(bundle.character.name)}`,
      });
    }
  }

  // 12. alternate_greetings length
  {
    const expected = getDataField<unknown[]>(raw, "alternate_greetings");
    if (Array.isArray(expected) && bundle.character.alternate_greetings.length !== expected.length) {
      violations.altGreetingsLength.push({
        card: cardName,
        detail: `expected ${expected.length}, got ${bundle.character.alternate_greetings.length}`,
      });
    }
  }

  // 13. tags length
  {
    const expected = getDataField<unknown[]>(raw, "tags");
    if (Array.isArray(expected) && bundle.character.tags.length !== expected.length) {
      violations.tagsLength.push({
        card: cardName,
        detail: `expected ${expected.length}, got ${bundle.character.tags.length}`,
      });
    }
  }
}

/** Render a progress line to stderr. Uses CR-overwrite when a TTY is
 *  detected (interactive terminal), falls back to one line every 50
 *  cards when stderr is captured / piped (CI, redirect to file). Always
 *  bypasses bun:test's stdout capture by writing to stderr directly. */
function progress(current: number, total: number, label: string): void {
  const isTty = (process.stderr as { isTTY?: boolean }).isTTY === true;
  if (isTty) {
    const pct = Math.floor((current / total) * 100);
    const barLen = 30;
    const filled = Math.floor((current / total) * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const trimmed = label.length > 38 ? label.slice(0, 35) + "..." : label;
    const line = `[${bar}] ${current}/${total} (${pct}%) ${trimmed.padEnd(38)}`;
    process.stderr.write(`\r${line}`);
    if (current === total) process.stderr.write("\n");
  } else if (current % 50 === 0 || current === total) {
    process.stderr.write(`[invariants] ${current}/${total}\n`);
  }
}

/** Single corpus pass. Reads each card, translates, runs inline invariants,
 *  drops the heavyweight refs before the next iteration. Memory peak is
 *  one card's bundle. */
function walkCorpus(): void {
  const paths = listLibraryCards();
  totalCount = paths.length;
  if (paths.length === 0) return;
  process.stderr.write(`[invariants] walking corpus (${paths.length} cards)...\n`);
  let processed = 0;
  for (const path of paths) {
    const f = path.replace(/\\/g, "/").split("/").pop() ?? path;
    processed++;
    progress(processed, paths.length, f);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch {
      continue;
    }
    let raw: CharxBundle | null = null;
    let bundle: LumiBundle | null = null;
    try {
      raw = readCharx(bytes);
      bundle = translateCharx(bytes, { mode: "full" });
    } catch {
      translateFailureCount++;
      // raw/bundle/bytes go out of scope here — GC reclaims before next iter
      continue;
    }
    analyzedCount++;
    runInvariants(f, raw, bundle);
    // raw, bundle, bytes drop refs at end of loop iteration
  }
  process.stderr.write(`[invariants] done — analyzed ${analyzedCount}, failed ${translateFailureCount}\n`);
}

walkCorpus();

describe("import-time cross-surface invariants", () => {
  if (analyzedCount === 0) {
    test.skip("no corpus available", () => {});
    return;
  }

  // 1. The canonical bug. Asset names lowercased in `asset_index` would
  // break card-author idioms like `<img src=AssetName>` →
  // `{{equal}}` against `{{assetlist}}`.
  test("asset_index keys preserve author-case from additional_assets[].name", () => {
    reportFirstFew("asset-name-case", violations.assetNameCase);
    expect(violations.assetNameCase).toEqual([]);
  });

  // 2. Same bug class for emotion images.
  test("emotion_index keys preserve author-case from emotion_images[].name", () => {
    reportFirstFew("emotion-name-case", violations.emotionNameCase);
    expect(violations.emotionNameCase).toEqual([]);
  });

  // 3. Translator + reader must agree on path normalization. A drop here
  // means an asset is silently un-uploadable.
  test("additional_assets[].path always present in bundle.assets", () => {
    reportFirstFew("asset-path-presence", violations.assetPathPresence);
    expect(violations.assetPathPresence).toEqual([]);
  });

  // 4. Same path-presence check for the emotion pool.
  test("emotion_images[].path always present in bundle.assets", () => {
    reportFirstFew("emotion-path-presence", violations.emotionPathPresence);
    expect(violations.emotionPathPresence).toEqual([]);
  });

  // 5. Verbatim passthrough — catches "someone added trim/normalize at
  // extract time" silently.
  test("risuPayload.background_html byte-identical to data.extensions.risuai.backgroundHTML", () => {
    reportFirstFew("bg-html-roundtrip", violations.bgHtmlRoundtrip);
    expect(violations.bgHtmlRoundtrip).toEqual([]);
  });

  // 6. Same for virtualscript. Mostly empty in corpus (Risu strips it on
  // export) but the invariant guards against silent transformation if it
  // does land.
  test("risuPayload.virtualscript byte-identical to data.extensions.risuai.virtualscript", () => {
    reportFirstFew("virtualscript-roundtrip", violations.virtualscriptRoundtrip);
    expect(violations.virtualscriptRoundtrip).toEqual([]);
  });

  // 7. Boolean coercion exact-match. A change here would silently flip
  // the degraded-load warning the extension surfaces at import time.
  test("risuPayload.utility_bot reflects data.extensions.risuai.utilityBot", () => {
    reportFirstFew("utility-bot", violations.utilityBot);
    expect(violations.utilityBot).toEqual([]);
  });

  // 8. The translator should call parseScriptstateDefaults. If anyone
  // "improves" the parse silently, the runtime's getChatVar fallback
  // (load-bearing for cards with variable-driven portrait icons) diverges
  // from re-parse.
  test("scriptstate_defaults equals parseScriptstateDefaults(defaultVariables)", () => {
    reportFirstFew("script-defaults-roundtrip", violations.scriptDefaults);
    expect(violations.scriptDefaults).toEqual([]);
  });

  // 9. Parallel-array invariant — runtime dispatcher uses index lookup,
  // misalignment silently invokes the wrong trigger's Lua.
  test("lua_scripts.length === triggers.length (parallel-array invariant)", () => {
    reportFirstFew("lua-length", violations.luaLength);
    expect(violations.luaLength).toEqual([]);
  });

  // 10. Semantic counterpart of #9 — even with matching lengths,
  // alignment can break if extraction drops Lua silently.
  test("lua_scripts[i] non-empty iff triggers[i] has a triggerlua effect", () => {
    reportFirstFew("lua-alignment", violations.luaAlignment);
    expect(violations.luaAlignment).toEqual([]);
  });

  // 11. The mapper intentionally does NOT trim/normalize — Lumi treats
  // names as opaque strings.
  test("LumiCharacter.name === card.data.name verbatim", () => {
    reportFirstFew("char-name", violations.charName);
    expect(violations.charName).toEqual([]);
  });

  // 12. Drop here would silently remove user-pickable greeting variants.
  test("LumiCharacter.alternate_greetings.length === card.data.alternate_greetings.length", () => {
    reportFirstFew("alt-greetings-length", violations.altGreetingsLength);
    expect(violations.altGreetingsLength).toEqual([]);
  });

  // 13. Tags count parity.
  test("LumiCharacter.tags.length === card.data.tags.length", () => {
    reportFirstFew("tags-length", violations.tagsLength);
    expect(violations.tagsLength).toEqual([]);
  });

  // Diagnostic — surfaces analysis coverage so a corpus shrink or a
  // wholesale translateCharx regression is loud rather than a silent
  // green pass on zero cards.
  test("(diagnostic) reports analysis coverage", () => {
    console.log(`[invariants] analyzed ${analyzedCount}/${totalCount} corpus cards (translate failures: ${translateFailureCount})`);
    expect(analyzedCount).toBeGreaterThan(0);
  });
});
