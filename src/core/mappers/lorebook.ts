import type { LoreBook } from "../schemas/lorebook.js";
import type { LumiWorldBookEntry } from "../lumiverse/types.js";
import { newUuid, nowMs, splitKeywords } from "./util.js";
import {
  parseDecorators,
  applyDecoratorsToEntry,
  serializeDecorator,
  type ParsedDecorator,
} from "./lorebook-decorators.js";
export {
  ENTRY_HASH_FIELDS,
  computeEntrySourceHash,
  hasUserEditedAnyEntry,
} from "./lorebook-hash.js";
import { computeEntrySourceHash } from "./lorebook-hash.js";


export interface MapLorebookOptions {
  readonly worldBookId: string;
  readonly now?: () => number;
  readonly uuid?: () => string;
}

/** Aggregate stats from one mapLoreBook call — surfaced by the importer for
 *  a single deliberate log line so we don't burn log lines per-entry. */
export interface DecoratorStats {
  /** Entries whose content carried at least one `@@`-prefixed decorator. */
  readonly entries_with_decorators: number;
  /** Total decorators parsed across all entries. */
  readonly decorators_seen: number;
  /** Decorators that mapped to a Lumi field (Tier 1). */
  readonly mapped: number;
  /** Decorators stashed on `extensions._risu_decorators` for runtime intercept. */
  readonly stashed: number;
  /** Decorators that Risu would have suspended on (bad args, unknown name). */
  readonly dropped: number;
}

function buildFolderIndex(entries: readonly LoreBook[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const e of entries) {
    if (e.mode === "folder" && e.id) {
      byId.set(e.id, e.comment || "");
    }
  }
  return byId;
}

function resolveFolderName(entry: LoreBook, folders: Map<string, string>): string {
  const f = entry.folder;
  if (!f) return "";
  const idx = f.indexOf(":");
  const uuid = idx >= 0 ? f.slice(idx + 1) : f;
  return folders.get(uuid) ?? "";
}

function mapMode(e: LoreBook): { constant: boolean; disabled: boolean; position: number } {
  if (e.mode === "folder") {
    return { constant: false, disabled: true, position: 0 };
  }
  const constant = e.mode === "constant" || !!e.alwaysActive;
  return { constant, disabled: false, position: 0 };
}

function buildExtensions(e: LoreBook, idx: number): Record<string, unknown> {
  const ext: Record<string, unknown> = {};
  // Risu spells it "extentions", preserve as-is.
  if (e.extentions !== undefined) ext["risu_extentions"] = e.extentions;
  if (e.loreCache !== undefined) ext["risu_lore_cache"] = e.loreCache;
  if (e.bookVersion !== undefined) ext["risu_book_version"] = e.bookVersion;
  if (e.mode !== undefined) ext["risu_mode"] = e.mode;
  if (e.folder !== undefined) ext["risu_folder"] = e.folder;
  if (e.id !== undefined) ext["risu_entry_id"] = e.id;
  // Source array position drives our viewer's visual order. Excluded from
  // _risu_source_hash so v6 backfill matches existing entries.
  ext["_risu_array_index"] = idx;
  return ext;
}

// Keep Tier 2/3 decorators inline so the runtime worldInfoInterceptor re-parses
// them on every activation and users can edit them via Lumi's content editor.
// `@@@`-fallback chains preserve the full block (dropping middle items shifts
// suspend semantics).
function rebuildContentWithStashedDecorators(
  rawContent: string,
  decorators: readonly ParsedDecorator[],
  applied: readonly ParsedDecorator[],
): string {
  if (decorators.length === 0) return rawContent;
  const hasFallback = decorators.some((d) => d.isFallback);
  if (hasFallback) return rawContent;
  const appliedSet = new Set(applied);
  const kept = decorators.filter((d) => !appliedSet.has(d));
  const lines = rawContent.split("\n");
  let cutoff = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("@@")) { cutoff = i; break; }
    cutoff = i + 1;
  }
  const remaining = lines.slice(cutoff).join("\n").trim();
  if (kept.length === 0) return remaining;
  const keptLines = kept.map(serializeDecorator);
  return remaining.length === 0
    ? keptLines.join("\n")
    : keptLines.join("\n") + "\n" + remaining;
}

export interface MappedLoreBookEntry {
  readonly entry: LumiWorldBookEntry;
  readonly stats: {
    /** Decorator lines parsed at the top of `content`. */
    readonly decoratorsSeen: number;
    /** Decorators applied via Tier 1 mapping. */
    readonly mapped: number;
    /** Decorators stashed on `extensions._risu_decorators`. */
    readonly stashed: number;
    /** Decorators Risu would have suspended on (bad args, unknown). */
    readonly dropped: number;
  };
}

export function mapLoreBookEntry(
  entry: LoreBook,
  worldBookId: string,
  folders: Map<string, string>,
  now: number,
  uuid: () => string,
  idx: number = 0,
): LumiWorldBookEntry {
  return mapLoreBookEntryWithStats(entry, worldBookId, folders, now, uuid, idx).entry;
}

export function mapLoreBookEntryWithStats(
  entry: LoreBook,
  worldBookId: string,
  folders: Map<string, string>,
  now: number,
  uuid: () => string,
  idx: number = 0,
): MappedLoreBookEntry {
  const { constant, disabled, position } = mapMode(entry);
  const groupName = resolveFolderName(entry, folders);

  const probability =
    entry.activationPercent !== undefined && entry.activationPercent !== null
      ? entry.activationPercent
      : 100;

  const caseSensitive = entry.extentions?.risu_case_sensitive === true;

  // Decorators live at the top of content. First non-@@ line ends the block.
  const parsed = parseDecorators(entry.content);
  const draftKey = splitKeywords(entry.key);
  const draftExt = buildExtensions(entry, idx);
  const applied = applyDecoratorsToEntry({ key: draftKey, extensions: draftExt }, parsed.decorators);

  // Decorator patch wins over Risu mode/extension defaults for Tier 1 fields.
  const finalKey = applied.patch.key ?? draftKey;
  const finalExtensions = applied.patch.extensions ?? draftExt;
  const finalContent = rebuildContentWithStashedDecorators(entry.content, parsed.decorators, applied.applied);

  const stats = {
    decoratorsSeen: parsed.decorators.length,
    mapped: applied.applied.length,
    stashed: applied.stashed.length,
    dropped: applied.dropped.length,
  };

  const built: LumiWorldBookEntry = {
    id: uuid(),
    world_book_id: worldBookId,
    uid: entry.id ?? uuid(),
    key: finalKey,
    keysecondary: splitKeywords(entry.secondkey),

    content: finalContent,
    comment: entry.comment,

    position: applied.patch.position ?? position,
    depth: applied.patch.depth ?? 0,
    role: applied.patch.role ?? null,
    order_value: entry.insertorder,

    selective: entry.selective,
    constant: applied.patch.constant ?? constant,
    disabled: applied.patch.disabled ?? disabled,

    group_name: groupName,
    group_override: false,
    group_weight: 1,

    probability: applied.patch.probability ?? probability,
    scan_depth: applied.patch.scan_depth ?? null,
    // Risu's chat array does not contain the first-message greeting. Mark the
    // projected entry so Lumiverse scans the equivalent message set.
    exclude_greeting: true,

    case_sensitive: caseSensitive,
    match_whole_words: applied.patch.match_whole_words ?? false,
    automation_id: null,
    use_regex: entry.useRegex === true,

    prevent_recursion: applied.patch.prevent_recursion ?? false,
    exclude_recursion: applied.patch.exclude_recursion ?? false,
    delay_until_recursion: false,
    priority: applied.patch.priority ?? 0,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: applied.patch.use_probability ?? (entry.activationPercent !== undefined && entry.activationPercent !== null),

    vectorized: false,
    vector_index_status: "not_enabled",
    vector_indexed_at: null,
    vector_index_error: null,

    extensions: finalExtensions,
    created_at: now,
    updated_at: now,
  };
  const sourceHash = computeEntrySourceHash(built as unknown as Record<string, unknown>);
  return {
    entry: {
      ...built,
      extensions: { ...built.extensions, _risu_source_hash: sourceHash },
    },
    stats,
  };
}


/** Map a list of lore entries plus aggregate decorator stats. */
export interface MapLoreBookResult {
  readonly entries: readonly LumiWorldBookEntry[];
  readonly decoratorStats: DecoratorStats;
}

export function mapLoreBook(
  entries: readonly LoreBook[],
  opts: MapLorebookOptions,
): LumiWorldBookEntry[] {
  return mapLoreBookWithStats(entries, opts).entries as LumiWorldBookEntry[];
}

export function mapLoreBookWithStats(
  entries: readonly LoreBook[],
  opts: MapLorebookOptions,
): MapLoreBookResult {
  const now = (opts.now ?? nowMs)();
  const uuid = opts.uuid ?? newUuid;
  const folders = buildFolderIndex(entries);
  const out: LumiWorldBookEntry[] = new Array(entries.length);
  let entries_with_decorators = 0;
  let decorators_seen = 0;
  let mapped = 0;
  let stashed = 0;
  let dropped = 0;
  for (let i = 0; i < entries.length; i++) {
    const r = mapLoreBookEntryWithStats(entries[i]!, opts.worldBookId, folders, now, uuid, i);
    out[i] = r.entry;
    if (r.stats.decoratorsSeen > 0) entries_with_decorators += 1;
    decorators_seen += r.stats.decoratorsSeen;
    mapped += r.stats.mapped;
    stashed += r.stats.stashed;
    dropped += r.stats.dropped;
  }
  return {
    entries: out,
    decoratorStats: {
      entries_with_decorators,
      decorators_seen,
      mapped,
      stashed,
      dropped,
    },
  };
}
