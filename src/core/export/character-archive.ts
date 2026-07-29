// Builds the entry plan for a `.lumirealm.charx` archive.
//
// Mirrors Risu's charx export: card.json carries the CCSv3 character, and
// triggerscript / customScripts / globalLore move into a synthesized
// module.risum and are deleted from the card.
//
// The Risu-facing half is source-primary: the stored import source is the
// baseline and live edits are overlaid only where they survive the round trip.
// The sidecar carries live rows verbatim, so our own reimport is lossless even
// where card.json cannot express an edit.

import { encodeRisum } from "../risum/codec.js";
import type { CustomScript } from "../schemas/customscript.js";
import type { LoreBook } from "../schemas/lorebook.js";
import { planAssetPath, ZipNameSanitizer } from "./asset-paths.js";
import { bytesToLatin1 } from "./module-archive.js";
import { reconcileLoreEntries, type LiveLoreEntry } from "./lore-back-projection.js";
import { reconcileRegexScripts, type LiveRegexRow } from "./regex-back-projection.js";
import {
  LUMIREALM_ARCHIVE_SCHEMA_VERSION,
  LUMIREALM_SIDECAR_ENTRY,
  type ArchiveAssetRef,
  type ArchivePlan,
  type LumirealmArchiveSidecar,
  type PlannedEntry,
} from "./archive-types.js";

export interface LiveCharacterFields {
  readonly name: string;
  readonly description?: string;
  readonly personality?: string;
  readonly scenario?: string;
  readonly first_mes?: string;
  readonly mes_example?: string;
  readonly creator_notes?: string;
  readonly system_prompt?: string;
  readonly post_history_instructions?: string;
  readonly tags?: readonly string[];
  readonly alternate_greetings?: readonly string[];
  readonly creator?: string;
  readonly extensions?: unknown;
}

export interface ResolvedAsset {
  readonly imageId: string;
  readonly ext?: string;
}

export interface BuildCharacterArchiveInput {
  readonly characterId: string;
  /** LumirealmCharacterData. Typed loosely so this module stays payload-agnostic. */
  readonly data: CharacterEnvelopeLike;
  readonly character: LiveCharacterFields;
  readonly worldBookEntries: readonly LiveLoreEntry[];
  readonly liveRegex: readonly LiveRegexRow[];
  readonly resolveAsset: (name: string) => ResolvedAsset | null;
  readonly resolveEmotion: (name: string) => ResolvedAsset | null;
  readonly avatarImageId: string | null;
  readonly extensionVersion: string;
  readonly now?: () => number;
  readonly uuid?: () => string;
}

export interface CharacterEnvelopeLike {
  readonly payload: {
    readonly triggers: readonly unknown[];
    readonly additional_assets: readonly { readonly name: string; readonly ext?: string }[];
    readonly emotion_images: readonly { readonly name: string; readonly ext?: string }[];
    readonly background_html: string | null;
    readonly background_html_source?: string | null;
    readonly utility_bot: boolean;
  };
  readonly source?: {
    readonly card?: unknown;
    readonly module?: unknown;
  };
  readonly user_overrides: {
    readonly default_variables_text?: string;
    readonly low_level_access_granted?: boolean;
  };
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sourceRisuai(card: unknown): Record<string, unknown> {
  const data = record(record(card)?.["data"]);
  const ext = record(data?.["extensions"]);
  return { ...(record(ext?.["risuai"]) ?? {}) };
}

/** Extensions the live character row carries, minus the keys our importer added
 *  on top of the card's own `data.extensions`. */
const IMPORTER_ADDED_EXTENSION_KEYS: readonly string[] = [
  "character_book", "character_version", "nickname", "group_only_greetings",
  "ccv3_creation_date", "ccv3_modification_date", "ccv3_source", "_lumirealm",
];

function baseExtensions(input: BuildCharacterArchiveInput): Record<string, unknown> {
  const fromSource = record(record(record(input.data.source?.card)?.["data"])?.["extensions"]);
  if (fromSource) return { ...fromSource };
  const live = record(input.character.extensions);
  if (!live) return {};
  const out = { ...live };
  for (const k of IMPORTER_ADDED_EXTENSION_KEYS) delete out[k];
  return out;
}

function sourceCustomScripts(input: BuildCharacterArchiveInput): readonly CustomScript[] {
  const mod = record(input.data.source?.module);
  const fromModule = mod?.["regex"];
  if (Array.isArray(fromModule)) return fromModule as readonly CustomScript[];
  const fromCard = sourceRisuai(input.data.source?.card)["customScripts"];
  return Array.isArray(fromCard) ? (fromCard as readonly CustomScript[]) : [];
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

function safeFileStem(name: string, fallback: string): string {
  const raw = name.trim().length > 0 ? name.trim() : fallback;
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 100) : fallback;
}

export function buildCharacterArchivePlan(input: BuildCharacterArchiveInput): ArchivePlan {
  const now = (input.now ?? Date.now)();
  const uuid = input.uuid ?? (() => "00000000-0000-4000-8000-000000000000");
  const char = input.character;
  const divergences: string[] = [];

  const sourceLore = resolveSourceLore(input);
  const lore = reconcileLoreEntries(sourceLore, input.worldBookEntries, uuid);
  if (lore.removed > 0) divergences.push(`${lore.removed} lore entr(ies) deleted in Lumiverse`);
  if (lore.added > 0) divergences.push(`${lore.added} lore entr(ies) added in Lumiverse`);

  const regex = reconcileRegexScripts(
    sourceCustomScripts(input),
    input.liveRegex,
    input.characterId,
    uuid,
  );
  for (const d of regex.divergences) {
    divergences.push(`regex[${d.sourceIndex}] "${d.comment}": ${d.reason}`);
  }
  if (regex.removed > 0) divergences.push(`${regex.removed} regex rule(s) deleted in Lumiverse`);
  if (regex.imported > 0) {
    divergences.push(
      `${regex.imported} standalone-imported regex rule(s) appended after the card's own scripts`,
    );
  }

  const seenPaths = new Set<string>();
  const sanitizer = new ZipNameSanitizer();
  const entries: PlannedEntry[] = [];
  const missingAssets: string[] = [];
  const cardAssets: { type: string; uri: string; name: string; ext: string }[] = [];
  const sidecarAssets: ArchiveAssetRef[] = [];
  const sidecarEmotions: ArchiveAssetRef[] = [];
  let assetIndex = 0;

  const pushAsset = (
    name: string,
    declaredExt: string,
    type: string,
    imageId: string,
  ): ArchiveAssetRef => {
    assetIndex += 1;
    const planned = planAssetPath(
      { type, name, ext: declaredExt || "unknown" },
      assetIndex,
      seenPaths,
    );
    const metaPath = sanitizer.sanitize(`x_meta/${planned.metaName}.json`);
    const path = sanitizer.sanitize(planned.path);
    entries.push({ kind: "image", path, imageId, level: 0, metaPath });
    cardAssets.push({ type, uri: `embeded://${path}`, name, ext: declaredExt || "png" });
    return declaredExt.length > 0 ? { name, path, ext: declaredExt } : { name, path };
  };

  for (const asset of input.data.payload.additional_assets) {
    const resolved = input.resolveAsset(asset.name);
    if (!resolved) { missingAssets.push(asset.name); continue; }
    sidecarAssets.push(
      pushAsset(asset.name, asset.ext ?? resolved.ext ?? "", "x-risu-asset", resolved.imageId),
    );
  }
  for (const emo of input.data.payload.emotion_images) {
    const resolved = input.resolveEmotion(emo.name);
    if (!resolved) { missingAssets.push(emo.name); continue; }
    sidecarEmotions.push(
      pushAsset(emo.name, emo.ext ?? resolved.ext ?? "png", "emotion", resolved.imageId),
    );
  }
  let avatar: ArchiveAssetRef | undefined;
  if (input.avatarImageId) {
    avatar = pushAsset("main", "png", "icon", input.avatarImageId);
  }

  const risuai = baseExtensions(input);
  const risuaiInner: Record<string, unknown> = { ...(record(risuai["risuai"]) ?? {}) };
  const bgHtml = input.data.payload.background_html_source
    ?? input.data.payload.background_html
    ?? "";
  risuaiInner["backgroundHTML"] = bgHtml;
  risuaiInner["utilityBot"] = input.data.payload.utility_bot === true;
  if (input.data.user_overrides.default_variables_text !== undefined) {
    risuaiInner["defaultVariables"] = input.data.user_overrides.default_variables_text;
  }
  // Risu's charx export relocates these into module.risum and deletes them.
  delete risuaiInner["triggerscript"];
  delete risuaiInner["customScripts"];
  risuai["risuai"] = risuaiInner;

  const sourceData = record(record(input.data.source?.card)?.["data"]);
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: char.name,
      description: char.description ?? "",
      personality: char.personality ?? "",
      scenario: char.scenario ?? "",
      first_mes: char.first_mes ?? "",
      mes_example: char.mes_example ?? "",
      creator_notes: char.creator_notes ?? "",
      system_prompt: char.system_prompt ?? "",
      post_history_instructions: char.post_history_instructions ?? "",
      alternate_greetings: [...(char.alternate_greetings ?? [])],
      character_book: {
        extensions: record(sourceData?.["character_book"])?.["extensions"] ?? {},
        entries: lore.entries.map(loreToCharacterBookEntry),
      },
      tags: [...(char.tags ?? [])],
      creator: char.creator ?? "",
      character_version: String(sourceData?.["character_version"] ?? ""),
      extensions: risuai,
      group_only_greetings: sourceData?.["group_only_greetings"] ?? [],
      nickname: sourceData?.["nickname"] ?? "",
      source: sourceData?.["source"] ?? [],
      creation_date: sourceData?.["creation_date"] ?? 0,
      modification_date: Math.floor(now / 1000),
      assets: cardAssets,
    },
  };

  const moduleBody = {
    name: `${char.name} Module`,
    description: `Module for ${char.name}`,
    id: uuid(),
    trigger: input.data.payload.triggers,
    regex: regex.scripts,
    lorebook: lore.entries,
  };

  entries.push({
    kind: "binary",
    path: sanitizer.sanitize("module.risum"),
    latin1: bytesToLatin1(encodeRisum({ module: moduleBody })),
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
    kind: "character",
    exported_at: now,
    extension_version: input.extensionVersion,
    character: {
      character_id: input.characterId,
      envelope: input.data,
      world_book_entries: input.worldBookEntries,
      regex_scripts: input.liveRegex,
      assets: sidecarAssets,
      emotions: sidecarEmotions,
      ...(avatar ? { avatar } : {}),
      divergences,
    },
  };
  entries.push({
    kind: "text",
    path: sanitizer.sanitize(LUMIREALM_SIDECAR_ENTRY),
    text: JSON.stringify(sidecar, null, 2),
    level: 6,
  });

  return {
    fileName: `${safeFileStem(char.name, input.characterId)}.lumirealm.charx`,
    entries,
    missingAssets,
  };
}

function resolveSourceLore(input: BuildCharacterArchiveInput): readonly LoreBook[] {
  const mod = record(input.data.source?.module);
  const fromModule = mod?.["lorebook"];
  if (Array.isArray(fromModule) && fromModule.length > 0) {
    return fromModule as readonly LoreBook[];
  }
  const book = record(record(record(input.data.source?.card)?.["data"])?.["character_book"]);
  const raw = book?.["entries"];
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const o = record(e) ?? {};
    const keys = Array.isArray(o["keys"]) ? (o["keys"] as unknown[]).filter((k): k is string => typeof k === "string") : [];
    const sec = Array.isArray(o["secondary_keys"]) ? (o["secondary_keys"] as unknown[]).filter((k): k is string => typeof k === "string") : [];
    return {
      key: keys.join(","),
      secondkey: sec.join(","),
      insertorder: typeof o["insertion_order"] === "number" ? o["insertion_order"] : 0,
      comment: typeof o["comment"] === "string" ? o["comment"] : (typeof o["name"] === "string" ? o["name"] : ""),
      content: typeof o["content"] === "string" ? o["content"] : "",
      mode: o["constant"] === true ? "constant" : "normal",
      alwaysActive: o["constant"] === true,
      selective: o["selective"] === true,
    } as unknown as LoreBook;
  });
}
