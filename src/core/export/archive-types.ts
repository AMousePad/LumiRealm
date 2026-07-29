// `.lumirealm.charx` / `.lumirealm.module` container shape.
//
// The archive is a Risu `.charx` ZIP plus one extra entry. Both Risu's
// CharXImporter and our own reader ignore unrecognized top-level `.json`
// entries, so `lumirealm.json` is invisible to anything that predates it.
// card.json and module.risum stay Risu-truthful, the sidecar is authoritative
// on reimport into LumiRealm.

export const LUMIREALM_SIDECAR_ENTRY = "lumirealm.json" as const;

/** Bump on any breaking change to the sidecar payload shape. */
export const LUMIREALM_ARCHIVE_SCHEMA_VERSION = 1 as const;

export type ArchiveKind = "character" | "module";

/** Positional with `module.assets`, whose uri field is blanked on export. */
export interface ArchiveAssetRef {
  readonly name: string;
  /** Path of the asset's ZIP entry. */
  readonly path: string;
  readonly ext?: string;
}

export interface ModuleArchivePayload {
  readonly id: string;
  readonly filename: string;
  /** Full RisuModule with asset uris blanked. Carries `cjs` / `namespace` /
   *  `mcp`, which Risu's own module-to-charx conversion drops. */
  readonly module: unknown;
  readonly assets: readonly ArchiveAssetRef[];
  readonly icon?: ArchiveAssetRef;
  readonly translator_schema_version?: number;
  readonly translations?: unknown;
}

export interface CharacterArchivePayload {
  readonly character_id: string;
  /** The full LumirealmCharacterData. Keeps `source` so a reimported card can
   *  still lazily retranslate instead of landing as a legacy needs-reimport. */
  readonly envelope: unknown;
  /** Live rows verbatim. Authoritative on reimport, since card.json and
   *  module.risum can only carry what Risu's shapes express. */
  readonly world_book_entries: readonly unknown[];
  readonly regex_scripts: readonly unknown[];
  readonly assets: readonly ArchiveAssetRef[];
  readonly emotions: readonly ArchiveAssetRef[];
  /** Card assets Risu keeps as `ccAssets` (background, user_icon, non-main icons). */
  readonly cc_assets?: readonly ArchiveAssetRef[];
  readonly avatar?: ArchiveAssetRef;
  /** Live edits the Risu-facing half could not represent. */
  readonly divergences: readonly string[];
}

export interface LumirealmArchiveSidecar {
  readonly schema_version: typeof LUMIREALM_ARCHIVE_SCHEMA_VERSION;
  readonly kind: ArchiveKind;
  readonly exported_at: number;
  readonly extension_version: string;
  readonly module?: ModuleArchivePayload;
  readonly character?: CharacterArchivePayload;
}

export function isLumirealmSidecar(v: unknown): v is LumirealmArchiveSidecar {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o["schema_version"] !== LUMIREALM_ARCHIVE_SCHEMA_VERSION) return false;
  return o["kind"] === "character" || o["kind"] === "module";
}

/** Deflate level per entry, mirroring Risu's CharXWriter call sites. */
export type ArchiveLevel = 0 | 6;

/** An entry the worker can materialize on its own. */
export interface PlannedTextEntry {
  readonly kind: "text";
  readonly path: string;
  readonly text: string;
  readonly level: ArchiveLevel;
}

/** Binary entry the worker produced. `latin1` is one char per byte so the
 *  bytes survive the JSON WS frame without a base64 size penalty. */
export interface PlannedBinaryEntry {
  readonly kind: "binary";
  readonly path: string;
  readonly latin1: string;
  readonly level: ArchiveLevel;
}

/** An entry whose bytes only the browser can fetch: `spindle.images.get`
 *  returns metadata and a URL, never the bytes. */
export interface PlannedImageEntry {
  readonly kind: "image";
  readonly path: string;
  readonly imageId: string;
  readonly level: ArchiveLevel;
  /** Emitted immediately before the asset, matching Risu's write order. */
  readonly metaPath: string;
}

export type PlannedEntry = PlannedTextEntry | PlannedBinaryEntry | PlannedImageEntry;

export interface ArchivePlan {
  readonly fileName: string;
  readonly entries: readonly PlannedEntry[];
  /** Asset names that had no resolvable image id. Surfaced, never silent. */
  readonly missingAssets: readonly string[];
}
