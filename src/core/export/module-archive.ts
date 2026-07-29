// Builds the entry plan for a `.lumirealm.module` archive.
//
// Mirrors Risu's module export chain: convertModuleToCharacter -> createBaseV3
// -> CharXWriter. Assets are planned, not fetched: `spindle.images.get` returns
// metadata only, so the browser resolves image ids to bytes.

import { encodeRisum } from "../risum/codec.js";
import type { LoreBook } from "../schemas/lorebook.js";
import type { RisuModule } from "../schemas/module.js";
import { planAssetPath, ZipNameSanitizer } from "./asset-paths.js";
import {
  LUMIREALM_ARCHIVE_SCHEMA_VERSION,
  LUMIREALM_SIDECAR_ENTRY,
  type ArchiveAssetRef,
  type ArchivePlan,
  type LumirealmArchiveSidecar,
  type PlannedEntry,
} from "./archive-types.js";

const INDICATOR_DESC = "@@indicator character_desc";
const INDICATOR_FIRST_MESSAGE = "@@indicator character_first_message";
const INDICATOR_PHI = "@@indicator phi";

export interface ResolvedModuleAsset {
  readonly imageId: string;
  readonly ext?: string;
}

export interface BuildModuleArchiveInput {
  readonly module: RisuModule;
  readonly moduleId: string;
  readonly filename: string;
  readonly extensionVersion: string;
  /** Resolves a module asset name to its Lumi image id, or null if unknown. */
  readonly resolveAsset: (name: string) => ResolvedModuleAsset | null;
  readonly iconImageId: string | null;
  readonly translatorSchemaVersion?: number;
  readonly translations?: unknown;
  readonly now?: () => number;
}

export interface HoistedIndicatorFields {
  readonly lorebook: readonly LoreBook[];
  readonly description: string;
  readonly firstMessage: string;
  readonly alternateGreetings: readonly string[];
  readonly postHistoryInstructions: string;
}

/** Reverse of the indicator entries our module reader appends. Risu hoists the
 *  same three markers back into character fields, so leaving them in the
 *  lorebook duplicates them on every export/import cycle. */
export function hoistIndicatorEntries(
  entries: readonly LoreBook[],
): HoistedIndicatorFields {
  const kept: LoreBook[] = [];
  let description = "";
  let firstMessage = "";
  let alternateGreetings: string[] = [];
  let postHistoryInstructions = "";

  for (const entry of entries) {
    const content = typeof entry.content === "string" ? entry.content : "";
    if (content.startsWith(INDICATOR_PHI)) {
      postHistoryInstructions = content.slice(INDICATOR_PHI.length).trim();
      continue;
    }
    if (content.startsWith(INDICATOR_DESC)) {
      description = content.slice(INDICATOR_DESC.length).trim();
      continue;
    }
    if (content.startsWith(INDICATOR_FIRST_MESSAGE)) {
      const body = content.slice(INDICATOR_FIRST_MESSAGE.length).trim();
      firstMessage = body.match(/<FM>([\s\S]*?)<\/FM>/)?.[1]?.trim() ?? "";
      alternateGreetings = [...body.matchAll(/<FM_alt>([\s\S]*?)<\/FM_alt>/g)]
        .map((m) => (m[1] ?? "").trim());
      continue;
    }
    kept.push(entry);
  }

  return { lorebook: kept, description, firstMessage, alternateGreetings, postHistoryInstructions };
}

interface CardAsset {
  readonly type: string;
  readonly uri: string;
  readonly name: string;
  readonly ext: string;
}

/** Port of createBaseV3's lore mapping. */
function loreToCharacterBookEntry(lore: LoreBook): Record<string, unknown> {
  const ext: Record<string, unknown> = { ...(lore.extentions ?? {}) };
  ext["risu_activationPercent"] = lore.activationPercent;
  ext["risu_loreCache"] = lore.loreCache;

  return {
    keys: (lore.key ?? "").split(",").map((r) => r.trim()),
    secondary_keys: lore.selective
      ? (lore.secondkey ?? "").split(",").map((r) => r.trim())
      : undefined,
    content: lore.content,
    extensions: ext,
    enabled: true,
    insertion_order: lore.insertorder,
    constant: lore.alwaysActive,
    selective: lore.selective,
    name: lore.comment,
    comment: lore.comment,
    case_sensitive: (lore.extentions ?? {})["risu_case_sensitive"] === true,
    use_regex: lore.useRegex ?? false,
    mode: lore.mode ?? "normal",
    folder: lore.folder,
  };
}

export function buildModuleArchivePlan(input: BuildModuleArchiveInput): ArchivePlan {
  const now = (input.now ?? Date.now)();
  const module = input.module;
  const hoisted = hoistIndicatorEntries(
    Array.isArray(module.lorebook) ? (module.lorebook as readonly LoreBook[]) : [],
  );

  const seenPaths = new Set<string>();
  const sanitizer = new ZipNameSanitizer();
  const entries: PlannedEntry[] = [];
  const missingAssets: string[] = [];
  const sidecarAssets: ArchiveAssetRef[] = [];
  const cardAssets: CardAsset[] = [];
  let assetIndex = 0;

  const pushAsset = (
    name: string,
    declaredExt: string,
    type: string,
    imageId: string,
    pathExt: string,
  ): ArchiveAssetRef => {
    assetIndex += 1;
    const planned = planAssetPath({ type, name, ext: pathExt }, assetIndex, seenPaths);
    const metaPath = sanitizer.sanitize(`x_meta/${planned.metaName}.json`);
    const path = sanitizer.sanitize(planned.path);
    entries.push({ kind: "image", path, imageId, level: 0, metaPath });
    cardAssets.push({ type, uri: `embeded://${path}`, name, ext: declaredExt });
    const ref: ArchiveAssetRef = declaredExt.length > 0
      ? { name, path, ext: declaredExt }
      : { name, path };
    sidecarAssets.push(ref);
    return ref;
  };

  // The schema's preprocess wrapper widens the tuple, so re-narrow here.
  const rawAssets: readonly (readonly [string, string, string])[] = Array.isArray(module.assets)
    ? (module.assets as unknown as readonly (readonly [string, string, string])[])
    : [];
  for (const triple of rawAssets) {
    const name = typeof triple[0] === "string" ? triple[0] : "";
    if (name.length === 0) continue;
    const resolved = input.resolveAsset(name);
    if (!resolved) {
      missingAssets.push(name);
      continue;
    }
    const declaredExt = typeof triple[2] === "string" && triple[2].length > 0
      ? triple[2]
      : (resolved.ext ?? "");
    pushAsset(name, declaredExt, "x-risu-asset", resolved.imageId, declaredExt || "unknown");
  }

  let icon: ArchiveAssetRef | undefined;
  if (input.iconImageId) {
    icon = pushAsset("main", "png", "icon", input.iconImageId, "png");
  }

  const blankedAssets = rawAssets.map(
    (t) => [t[0] ?? "", "", t[2] ?? ""] as [string, string, string],
  );
  // Risu's charx writer only stores {name,description,id,trigger,regex,lorebook}
  // here and its importer reads only trigger/regex/lorebook. Carrying the rest
  // is inert for Risu and lets our reader recover cjs/namespace/mcp without the
  // sidecar.
  const moduleForRisum: Record<string, unknown> = {
    ...module,
    lorebook: hoisted.lorebook,
    assets: blankedAssets,
    icon: "",
  };

  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: typeof module.name === "string" ? module.name : "",
      description: hoisted.description,
      personality: "",
      scenario: "",
      first_mes: hoisted.firstMessage,
      mes_example: "",
      creator_notes: typeof module.description === "string" ? module.description : "",
      system_prompt: "",
      post_history_instructions: hoisted.postHistoryInstructions,
      alternate_greetings: hoisted.alternateGreetings,
      character_book: {
        extensions: {},
        entries: hoisted.lorebook.map(loreToCharacterBookEntry),
      },
      tags: [],
      creator: "",
      // Risu emits the literal string "undefined" here on module export (a
      // template literal over an absent additionalData). Not replicated.
      character_version: "",
      extensions: {
        risuai: {
          bias: [],
          viewScreen: "none",
          customScripts: [],
          utilityBot: false,
          backgroundHTML: typeof module.backgroundEmbedding === "string"
            ? module.backgroundEmbedding
            : "",
          triggerscript: [],
          additionalText: "",
          virtualscript: "",
          lowLevelAccess: module.lowLevelAccess === true,
          defaultVariables: "",
          toggles: typeof module.customModuleToggle === "string"
            ? module.customModuleToggle
            : "",
        },
      },
      group_only_greetings: [],
      nickname: "",
      source: [],
      creation_date: 0,
      modification_date: Math.floor(now / 1000),
      assets: cardAssets,
    },
  };

  entries.push({
    kind: "binary",
    path: sanitizer.sanitize("module.risum"),
    latin1: bytesToLatin1(encodeRisum({ module: moduleForRisum })),
    level: 0,
  });
  entries.push({
    kind: "text",
    path: sanitizer.sanitize("card.json"),
    text: JSON.stringify(card, null, 4),
    level: 0,
  });

  const sidecar: LumirealmArchiveSidecar = {
    schema_version: LUMIREALM_ARCHIVE_SCHEMA_VERSION,
    kind: "module",
    exported_at: now,
    extension_version: input.extensionVersion,
    module: {
      id: input.moduleId,
      filename: input.filename,
      module: { ...module, assets: blankedAssets, icon: "" },
      assets: sidecarAssets,
      ...(icon ? { icon } : {}),
      ...(input.translatorSchemaVersion !== undefined
        ? { translator_schema_version: input.translatorSchemaVersion }
        : {}),
      ...(input.translations !== undefined ? { translations: input.translations } : {}),
    },
  };
  entries.push({
    kind: "text",
    path: sanitizer.sanitize(LUMIREALM_SIDECAR_ENTRY),
    text: JSON.stringify(sidecar, null, 2),
    level: 6,
  });

  return {
    fileName: `${safeFileStem(module.name, input.moduleId)}.lumirealm.module`,
    entries,
    missingAssets,
  };
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x2000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function safeFileStem(name: unknown, fallback: string): string {
  const raw = typeof name === "string" && name.trim().length > 0 ? name.trim() : fallback;
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 100) : fallback;
}
