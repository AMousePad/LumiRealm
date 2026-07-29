import { readCharx } from "../charx/reader.js";
import { base64ToBytes } from "../../util/base64.js";
import { parseRisuModule } from "../schemas/parse.js";
import { mapCharacter } from "../mappers/character.js";
import { mapLoreBook, mapLoreBookWithStats } from "../mappers/lorebook.js";
import { mapRegex, type AtAtAction } from "../mappers/regex.js";
import { compileAtActions } from "../mappers/at-actions.js";
import { compileTriggers } from "../mappers/triggers.js";
import { buildBackgroundHtmlScript } from "../mappers/background-html.js";
import { newUuid, nowMs } from "../mappers/util.js";
import { customscriptSchema, type CustomScript } from "../schemas/customscript.js";
import { triggerscriptSchema, type TriggerScript } from "../schemas/triggerscript.js";
import type { LoreBook } from "../schemas/lorebook.js";
import type { LumiCharacter, LumiRegexScript, LumiWorldBook, LumiWorldBookEntry } from "../lumiverse/types.js";
import type { LumiBundle, ScriptPackEntry, TranslationManifest, UntranslatedSummary } from "./types.js";
import { TranslationError } from "../errors.js";
import { buildRisuPayload } from "./risu-payload.js";
import { prepareBackgroundHtmlForRuntime } from "../mappers/background-html.js";
import {
  SvgIndexer,
  extractAndReplaceSvgs,
  type SvgRasterTask,
} from "../svg-rasterize.js";
import type { RisuPayload } from "../payload/types.js";


const TRANSLATOR_VERSION = "0.1.0"; // M17-lite

const RISU_SPEC_VERSION = "risu-1";

export type TranslateMode = "full" | "walking-skeleton" | "diagnostic";

export interface TranslateCharxOptions {
  readonly sourceId?: string;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly includeAssets?: boolean;
  readonly mode?: TranslateMode;
  readonly emitRegex?: boolean;
  readonly emitTriggers?: boolean;
  readonly emitBgHtml?: boolean;
  readonly emitPackScripts?: boolean;
}

export function translateCharx(
  bytes: Uint8Array,
  opts: TranslateCharxOptions = {},
): LumiBundle {
  return translateFromCharxBundle(readCharx(bytes), opts);
}

// Synthesizes a CharxBundle from stored Risu source so we can re-run the
// translator without keeping the original .charx bytes.
export function translateFromStoredSource(
  source: { card: unknown; module: unknown | null },
  opts: TranslateCharxOptions = {},
): LumiBundle {
  const moduleEnvelope = source.module
    ? { version: 1, module: source.module, assets: [], payloadText: "" }
    : null;
  const bundle = {
    card: source.card,
    cardJsonText: null,
    moduleBytes: null,
    moduleEnvelope,
    sidecar: null,
    assets: new Map<string, Uint8Array>(),
    xMeta: new Map<string, unknown>(),
    oversizedEntries: [],
    unsafeEntries: [],
    issues: [],
    isPolyglot: false,
    jpegPreview: null,
  };
  return translateFromCharxBundle(bundle as ReturnType<typeof readCharx>, opts);
}

// Decode inline `data:` URIs in card.data.assets[] into ZIP-shaped entries so
// the rest of the pipeline only sees `embeded://` references.
const SYNTHETIC_DATA_URI_PREFIX = "__data_uri_";
function expandInlineDataUriAssets(
  card: unknown,
  assets: Map<string, Uint8Array>,
): number {
  if (!card || typeof card !== "object") return 0;
  const data = (card as { data?: unknown }).data;
  if (!data || typeof data !== "object") return 0;
  const list = (data as { assets?: unknown }).assets;
  if (!Array.isArray(list)) return 0;
  let synthesized = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || typeof a !== "object") continue;
    const uri = (a as { uri?: unknown }).uri;
    if (typeof uri !== "string" || !uri.startsWith("data:")) continue;
    const comma = uri.indexOf(",");
    if (comma < 0) continue;
    const head = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    let bytes: Uint8Array;
    try {
      if (head.includes(";base64")) {
        bytes = base64ToBytes(body);
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(body));
      }
    } catch {
      continue;
    }
    const path = `${SYNTHETIC_DATA_URI_PREFIX}${i}`;
    assets.set(path, bytes);
    (a as { uri: string }).uri = `embeded://${path}`;
    synthesized += 1;
  }
  return synthesized;
}

export function translateFromCharxBundle(
  bundle: ReturnType<typeof readCharx>,
  opts: TranslateCharxOptions = {},
): LumiBundle {
  const now = opts.now ?? nowMs;
  const uuid = opts.uuid ?? newUuid;
  const issues: { path: string; message: string }[] = [];

  // ReadonlyMap is a compile-time view of the underlying mutable Map.
  expandInlineDataUriAssets(
    bundle.card,
    bundle.assets as Map<string, Uint8Array>,
  );

  const mode: TranslateMode = opts.mode ?? "diagnostic";

  const wantFull = mode === "full" || mode === "diagnostic";
  const wantRegex = opts.emitRegex ?? wantFull;
  const wantTriggers = opts.emitTriggers ?? wantFull;
  const wantBgHtml = opts.emitBgHtml ?? wantFull;

  for (const iss of bundle.issues) issues.push(iss);

  if (!bundle.card) {
    throw new TranslationError(
      "pipeline/missing_card",
      "charx bundle does not contain a readable card.json",
    );
  }

  const charMap = mapCharacter(bundle.card, {
    ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
    now,
    uuid,
  });
  for (const iss of charMap.issues) issues.push(iss);

  let moduleLorebook: readonly LoreBook[] = [];
  let moduleRegexScripts: readonly CustomScript[] = [];
  let moduleTriggerScripts: readonly TriggerScript[] = [];
  let moduleRegexCount = 0;
  let moduleTriggerCount = 0;
  let moduleCjs = false;
  let backgroundEmbedding = false;
  let mcp = false;
  if (bundle.moduleEnvelope) {
    try {
      const parsed = parseRisuModule(bundle.moduleEnvelope.module);
      for (const iss of parsed.issues) {
        issues.push({ path: iss.path.join("."), message: iss.message });
      }
      moduleLorebook = (parsed.module.lorebook ?? []) as readonly LoreBook[];
      moduleRegexScripts = (parsed.module.regex ?? []) as readonly CustomScript[];
      moduleTriggerScripts = (parsed.module.trigger ?? []) as readonly TriggerScript[];
      moduleRegexCount = parsed.module.regex?.length ?? 0;
      moduleTriggerCount = parsed.module.trigger?.length ?? 0;
      moduleCjs = typeof parsed.module.cjs === "string" && parsed.module.cjs.length > 0;
      backgroundEmbedding =
        typeof parsed.module.backgroundEmbedding === "string" &&
        parsed.module.backgroundEmbedding.length > 0;
      mcp = parsed.module.mcp != null && typeof parsed.module.mcp === "object";
      if (mcp) {
        issues.push({
          path: "module.mcp",
          message: "MCP server config present — LumiRealm does not run MCP servers; this module's MCP integration will not function.",
        });
      }
    } catch (e) {
      issues.push({
        path: "module",
        message: `module parse failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const charBookEntriesRaw = extractCharacterBookEntries(charMap.extracted.characterBook, issues);
  // Match Risu .charx import: when module.risum carries a lorebook, use ONLY
  // that and discard character_book entries. For non-charx formats (PNG/JSON,
  // no moduleEnvelope), use character_book.entries as before.
  const haveModuleLore = moduleLorebook.length > 0;
  const allLoreEntries: LoreBook[] = haveModuleLore
    ? [...moduleLorebook]
    : [...charBookEntriesRaw];
  const dropped = haveModuleLore ? charBookEntriesRaw.length : 0;
  if (dropped > 0) {
    issues.push({
      path: "lorebook",
      message: `dropped ${dropped} character_book entr${dropped === 1 ? "y" : "ies"} — module.lorebook is the authoritative copy when .charx ships both (matches Risu characterCards.ts:153)`,
    });
  }

  let worldBook: LumiWorldBook | null = null;
  let worldBookEntries: readonly LumiWorldBookEntry[] = [];
  let decoratorStats = {
    entries_with_decorators: 0,
    decorators_seen: 0,
    mapped: 0,
    stashed: 0,
    dropped: 0,
  };
  if (allLoreEntries.length > 0) {
    const wbId = uuid();
    const wbNow = now();
    worldBook = {
      id: wbId,
      name: charMap.character.name
        ? `${charMap.character.name} — lore`
        : "Translated lore",
      description: "Merged from Risu module.lorebook + card.character_book by LumiRealm.",
      metadata: {
        _lumirealm: {
          source: opts.sourceId ?? null,
          translated_at: wbNow,
          version: TRANSLATOR_VERSION,
          source_counts: {
            module_lorebook: moduleLorebook.length,
            character_book: charBookEntriesRaw.length,
            character_book_dropped: dropped,
          },
        },
      },
      created_at: wbNow,
      updated_at: wbNow,
    };
    const lbResult = mapLoreBookWithStats(allLoreEntries, { worldBookId: wbId, now, uuid });
    worldBookEntries = lbResult.entries;
    decoratorStats = lbResult.decoratorStats;
    void mapLoreBook; // re-export referenced from elsewhere; keep import live
  }

  const finalCharacter = charMap.character;

  const charRegexScripts = filterValidCustomScripts(
    charMap.extracted.customScripts,
    issues,
    "character_level_regex",
  );
  const charRegexOut = wantRegex
    ? mapRegex(charRegexScripts, {
        characterId: charMap.character.id, now, uuid, origin: "character",
      })
    : { rows: [] as LumiRegexScript[], skipped: [] as AtAtAction[], issues: [] as { path: string; message: string }[] };
  const moduleRegexOut = wantRegex
    ? mapRegex(moduleRegexScripts, {
        characterId: charMap.character.id, now, uuid, origin: "module",
      })
    : { rows: [] as LumiRegexScript[], skipped: [] as AtAtAction[], issues: [] as { path: string; message: string }[] };
  const regexScriptsRaw: readonly LumiRegexScript[] = [...charRegexOut.rows, ...moduleRegexOut.rows];
  for (const iss of charRegexOut.issues) issues.push(iss);
  for (const iss of moduleRegexOut.issues) issues.push(iss);
  const allAtActions: readonly AtAtAction[] = [...charRegexOut.skipped, ...moduleRegexOut.skipped];

  const svgIndexer = new SvgIndexer();
  let svgTemplatedSkipped = 0;
  let svgDangerousSkipped = 0;
  const regexScripts: readonly LumiRegexScript[] = regexScriptsRaw.map((row) => {
    if (!row.replace_string || row.replace_string.indexOf("<svg") < 0) return row;
    const r = extractAndReplaceSvgs(row.replace_string, svgIndexer);
    svgTemplatedSkipped += r.templatedSkipped;
    svgDangerousSkipped += r.dangerousSkipped;
    return r.rewritten === row.replace_string
      ? row
      : { ...row, replace_string: r.rewritten };
  });
  const regexUnknownTypes =
    charRegexOut.issues.filter((i) => i.message.startsWith("unknown Risu regex phase")).length +
    moduleRegexOut.issues.filter((i) => i.message.startsWith("unknown Risu regex phase")).length;

  const charTriggerScripts = filterValidTriggerScripts(
    charMap.extracted.triggerScripts,
    issues,
    "character_level_triggers",
  );
  const atActionsOut = wantTriggers
    ? compileAtActions(allAtActions, {
        characterId: charMap.character.id,
        characterName: charMap.character.name,
      })
    : { files: [] as ScriptPackEntry[], issues: [] as { path: string; message: string }[] };
  const triggersOut = wantTriggers
    ? compileTriggers(
        [...charTriggerScripts, ...moduleTriggerScripts],
        {
          characterId: charMap.character.id,
          characterName: charMap.character.name,
        },
      )
    : {
        files: [] as ScriptPackEntry[],
        issues: [] as { path: string; message: string }[],
        opcodeUnimplemented: {} as Record<string, number>,
        luaCount: 0,
      };
  const bgHtml = wantBgHtml
    ? buildBackgroundHtmlScript(charMap.extracted.backgroundHTML ?? null, {
        characterId: charMap.character.id,
        characterName: charMap.character.name,
      })
    : { file: null as ScriptPackEntry | null, issues: [] as { path: string; message: string }[] };
  for (const iss of bgHtml.issues) issues.push(iss);

  const emitPackScripts = opts.emitPackScripts !== false;
  const scripts: readonly ScriptPackEntry[] = emitPackScripts
    ? [
        ...atActionsOut.files,
        ...triggersOut.files,
        ...(bgHtml.file ? [bgHtml.file] : []),
      ]
    : [];
  for (const iss of atActionsOut.issues) issues.push(iss);
  for (const iss of triggersOut.issues) issues.push(iss);

  const assetsMap = opts.includeAssets === false ? new Map<string, Uint8Array>() : bundle.assets;

  const extSpec = charMap.character.extensions["_lumirealm"] as {
    spec: string;
    spec_version: string;
  };
  const hasMacrosInText = detectMacrosInText(charMap.character);

  const translatedCharRegex = charRegexOut.rows.length + charRegexOut.skipped.length;
  const translatedModuleRegex = moduleRegexOut.rows.length + moduleRegexOut.skipped.length;
  const translatedTriggers = triggersOut.files.length;

  const untranslated: UntranslatedSummary = {
    module_regex: Math.max(0, moduleRegexCount - translatedModuleRegex),
    module_triggers: Math.max(0, moduleTriggerCount - translatedTriggers),
    character_level_regex: Math.max(0, charMap.extracted.customScripts.length - translatedCharRegex),
    character_level_triggers: Math.max(
      0,
      charMap.extracted.triggerScripts.length - Math.min(translatedTriggers, charTriggerScripts.length),
    ),
    virtualscript: isNonEmpty(charMap.extracted.virtualScript),
    default_variables: isNonEmpty(charMap.extracted.defaultVariables),
    ...(isNonEmpty(charMap.extracted.additionalText) ? { additional_text: true } : {}),
    background_html: isNonEmpty(charMap.extracted.backgroundHTML) && bgHtml.file === null,
    background_embedding: backgroundEmbedding,
    ...(mcp ? { mcp: true } : {}),
    module_cjs: moduleCjs,
    macros_in_text: hasMacrosInText,
    regex_unknown_types: regexUnknownTypes,
    at_actions: allAtActions.length,
    ...(Object.keys(triggersOut.opcodeUnimplemented).length > 0
      ? { opcode_unimplemented: triggersOut.opcodeUnimplemented }
      : {}),
    ...(charMap.extracted.utilityBot ? { utility_bot: true } : {}),
    ...(svgIndexer.size() > 0 || svgTemplatedSkipped > 0 || svgDangerousSkipped > 0
      ? {
          svg_rasterized: svgIndexer.size(),
          svg_color_frozen: svgIndexer.getCounts()["theme-reactive"],
          svg_motion_frozen: svgIndexer.getCounts().animated,
          svg_templated_stripped: svgTemplatedSkipped,
          ...(svgDangerousSkipped > 0 ? { svg_dangerous_stripped: svgDangerousSkipped } : {}),
        }
      : {}),
  };

  const allTriggers = [...charTriggerScripts, ...moduleTriggerScripts];
  const hostFeaturesSet = new Set<string>();
  let needsLowLevelAccess = false;
  let usesRunImgGen = false;
  let usesCheckSimilarity = false;
  let usesCommand = false;
  if (charMap.extracted.utilityBot) hostFeaturesSet.add("utilityBot");
  for (const t of allTriggers) {
    if (t.lowLevelAccess) needsLowLevelAccess = true;
    for (const e of t.effect ?? []) {
      const typ = (e as { type?: string }).type;
      if (typ === "v2GetAlertSelect") hostFeaturesSet.add("alertSelect");
      else if (typ === "runImgGen" || typ === "v2ImgGen") {
        hostFeaturesSet.add("runImgGen");
        usesRunImgGen = true;
      }
      else if (typ === "checkSimilarity" || typ === "v2CheckSimilarity") {
        hostFeaturesSet.add("checkSimilarity");
        usesCheckSimilarity = true;
      }
      else if (typ === "v2Tokenize" || typ === "tokenize") hostFeaturesSet.add("tokenize");
      else if (typ === "command" || typ === "v2Command") {
        hostFeaturesSet.add("command");
        usesCommand = true;
      }
      else if (typ === "showAlert") {
        const alertType = (e as { alertType?: string }).alertType;
        if (alertType === "select") hostFeaturesSet.add("alertSelect");
      }
    }
  }
  if (usesRunImgGen) {
    issues.push({
      path: "trigger",
      message: "runImgGen / v2ImgGen effect present — Lumiverse has no image-gen surface. The call will reject cleanly.",
    });
  }
  if (usesCheckSimilarity) {
    issues.push({
      path: "trigger",
      message: "checkSimilarity / v2CheckSimilarity effect present — Lumiverse has no vector-similarity surface. The call will reject cleanly.",
    });
  }
  if (usesCommand) {
    issues.push({
      path: "trigger",
      message: "command / v2Command effect present — Lumiverse has no slash-command surface. The call will be a no-op.",
    });
  }
  const globalNote =
    typeof charMap.character.post_history_instructions === "string"
      ? charMap.character.post_history_instructions
      : "";
  if (globalNote.includes("{{original}}")) {
    issues.push({
      path: "character.replaceGlobalNote",
      message: "replaceGlobalNote contains {{original}} placeholder — LumiRealm cannot substitute the preset's global note (no spindle.presets API). The placeholder is dropped at prompt time.",
    });
  }
  const requires = {
    lowLevelAccess: needsLowLevelAccess,
    hostFeatures: [...hostFeaturesSet].sort(),
    lua: triggersOut.luaCount > 0,
  };

  let risuPayload: RisuPayload | null = null;
  if (mode !== "walking-skeleton") {
    const payloadUntranslated = untranslated.utility_bot
      ? { utility_bot: true }
      : undefined;
    const rawBg = charMap.extracted.backgroundHTML ?? null;
    const prepared = prepareBackgroundHtmlForRuntime(rawBg, {
      regexReplaceStrings: regexScripts.map((r) => r.replace_string ?? ""),
      svgIndexer,
    });
    svgTemplatedSkipped += prepared.svgTemplatedSkipped;
    svgDangerousSkipped += prepared.svgDangerousSkipped;
    const bgHtmlForPayload = prepared.translated;
    const adjustedExtracted =
      bgHtmlForPayload !== rawBg
        ? { ...charMap.extracted, backgroundHTML: bgHtmlForPayload }
        : charMap.extracted;
    risuPayload = buildRisuPayload({
      translatorVersion: TRANSLATOR_VERSION,
      risuSpecVersion: RISU_SPEC_VERSION,
      triggers: [...charTriggerScripts, ...moduleTriggerScripts],
      atActions: allAtActions,
      extracted: adjustedExtracted,
      characterExtensions: charMap.character.extensions,
      requires,
      ...(payloadUntranslated ? { untranslated: payloadUntranslated } : {}),
    });
  }

  const manifest: TranslationManifest = {
    translator: { name: "LumiRealm", version: TRANSLATOR_VERSION },
    source: {
      spec: extSpec.spec,
      spec_version: extSpec.spec_version,
      sourceId: opts.sourceId ?? null,
      isPolyglot: bundle.isPolyglot,
    },
    translated_at: now(),
    issues,
    untranslated,
    counts: {
      lorebook_entries: worldBookEntries.length,
      assets: assetsMap.size,
      oversized_entries: bundle.oversizedEntries.length,
      unsafe_entries: bundle.unsafeEntries.length,
    },
    requires,
  };

  const preferredAvatar = pickPreferredAvatar(bundle.card, bundle.assets);

  return {
    character: finalCharacter,
    worldBook,
    worldBookEntries,
    regexScripts,
    scripts,
    risuPayload,
    assets: assetsMap,
    preferredAvatar,
    pendingSvgRasters: svgIndexer.getTasks(),
    decoratorStats,
    manifest,
  };
}

function filterValidCustomScripts(
  raw: readonly unknown[],
  issues: { path: string; message: string }[],
  label: string,
): readonly CustomScript[] {
  const out: CustomScript[] = [];
  raw.forEach((item, i) => {
    const r = customscriptSchema.safeParse(item);
    if (r.success) out.push(r.data);
    else issues.push({ path: `${label}[${i}]`, message: r.error.issues[0]?.message ?? "invalid" });
  });
  return out;
}

function filterValidTriggerScripts(
  raw: readonly unknown[],
  issues: { path: string; message: string }[],
  label: string,
): readonly TriggerScript[] {
  const out: TriggerScript[] = [];
  raw.forEach((item, i) => {
    const r = triggerscriptSchema.safeParse(item);
    if (r.success) out.push(r.data);
    else issues.push({ path: `${label}[${i}]`, message: r.error.issues[0]?.message ?? "invalid" });
  });
  return out;
}

// Mirrors Risu icon-hoist: find {type:'icon',name:'main'}, last match wins.
function pickPreferredAvatar(
  card: unknown,
  assets: ReadonlyMap<string, Uint8Array>,
): { data: Uint8Array; mime: string; filename: string } | null {
  const data = (card as { data?: unknown })?.data as { assets?: unknown } | undefined;
  if (!data || !Array.isArray(data.assets)) return null;
  let resolved: { data: Uint8Array; mime: string; filename: string } | null = null;
  for (const raw of data.assets as readonly unknown[]) {
    const a = raw as { type?: unknown; name?: unknown; uri?: unknown; ext?: unknown };
    if (a.type !== "icon" || a.name !== "main") continue;
    const uri = typeof a.uri === "string" ? a.uri : "";
    if (uri.length === 0) continue;
    const ext = typeof a.ext === "string" ? a.ext.toLowerCase() : "";
    let bytes: Uint8Array | null = null;
    if (uri.startsWith("embeded://")) {
      const path = uri.slice("embeded://".length);
      bytes = assets.get(path) ?? null;
    } else if (uri.startsWith("__asset:")) {
      const key = uri.slice("__asset:".length);
      bytes = assets.get(key) ?? null;
    } else if (uri.startsWith("data:")) {
      const comma = uri.indexOf(",");
      if (comma > 0) {
        const head = uri.slice(0, comma);
        const body = uri.slice(comma + 1);
        try {
          if (head.includes(";base64")) {
            bytes = base64ToBytes(body);
          } else {
            bytes = new TextEncoder().encode(decodeURIComponent(body));
          }
        } catch {
          bytes = null;
        }
      }
    }
    if (bytes) {
      const mime = inferMimeFromExt(ext, uri);
      const filename = `main${ext.length > 0 ? `.${ext}` : ""}`;
      resolved = { data: bytes, mime, filename };
    }
  }
  return resolved;
}

function inferMimeFromExt(ext: string, uri: string): string {
  const e = ext.length > 0 ? ext : (uri.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1] ?? "").toLowerCase();
  switch (e) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    default: return "image/png";
  }
}

function extractCharacterBookEntries(
  raw: unknown,
  issues: { path: string; message: string }[],
): LoreBook[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries = (raw as Record<string, unknown>)["entries"];
  if (!Array.isArray(entries)) return [];
  const out: LoreBook[] = [];
  entries.forEach((e, i) => {
    if (!e || typeof e !== "object") {
      issues.push({ path: `character_book.entries[${i}]`, message: "entry is not an object" });
      return;
    }
    const obj = e as Record<string, unknown>;
    const keysField = obj["keys"];
    const keySecField = obj["secondary_keys"];
    const key = Array.isArray(keysField) ? keysField.filter((k) => typeof k === "string").join(",") : "";
    const secondkey = Array.isArray(keySecField) ? keySecField.filter((k) => typeof k === "string").join(",") : "";
    const mapped: Record<string, unknown> = {
      key,
      secondkey,
      insertorder: typeof obj["insertion_order"] === "number" ? obj["insertion_order"] : 0,
      comment: typeof obj["comment"] === "string" ? obj["comment"] : (typeof obj["name"] === "string" ? obj["name"] : ""),
      content: typeof obj["content"] === "string" ? obj["content"] : "",
      mode: obj["constant"] === true ? "constant" : "normal",
      alwaysActive: obj["constant"] === true,
      selective: obj["selective"] === true,
    };
    if (typeof obj["id"] === "string") mapped["id"] = obj["id"];
    if (typeof obj["case_sensitive"] === "boolean") {
      mapped["extentions"] = { risu_case_sensitive: obj["case_sensitive"] };
    }
    out.push(mapped as LoreBook);
  });
  return out;
}

function isNonEmpty(s: string | null): boolean {
  return typeof s === "string" && s.length > 0;
}

function detectMacrosInText(c: { description: string; personality: string; scenario: string; first_mes: string; mes_example: string; system_prompt: string; post_history_instructions: string; alternate_greetings: readonly string[]; }): boolean {
  const texts = [
    c.description, c.personality, c.scenario, c.first_mes, c.mes_example,
    c.system_prompt, c.post_history_instructions,
    ...c.alternate_greetings,
  ];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    if (t.indexOf("{{") >= 0) return true;
    const i = t.indexOf("{");
    if (i >= 0 && i + 1 < t.length) {
      const next = t.charCodeAt(i + 1);
      if (next !== 0x7b /* { */ && next !== 0x20 /* space */ && next !== 0x0a /* \n */) return true;
    }
  }
  return false;
}

