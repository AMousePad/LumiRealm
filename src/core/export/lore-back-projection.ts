// Inverse of `mapLoreBookEntryWithStats`, used only by the exporter.
//
// Strategy is recompute-and-diff rather than a blind field-by-field inverse:
// re-run the importer over the stored source entry and compare against the live
// row. An untouched row emits its source verbatim, which preserves decorator
// lines, argument spelling and ordering that the forward mapping folds into
// Lumi fields and cannot reconstruct faithfully.

import { mapLoreBookEntryWithStats } from "../mappers/lorebook.js";
import { serializeDecorator, type ParsedDecorator } from "../mappers/lorebook-decorators.js";
import type { LoreBook } from "../schemas/lorebook.js";
import type { LumiWorldBookEntry } from "../lumiverse/types.js";

export interface LiveLoreEntry {
  readonly key?: unknown;
  readonly keysecondary?: unknown;
  readonly content?: unknown;
  readonly comment?: unknown;
  readonly order_value?: unknown;
  readonly constant?: unknown;
  readonly disabled?: unknown;
  readonly selective?: unknown;
  readonly probability?: unknown;
  readonly use_probability?: unknown;
  readonly use_regex?: unknown;
  readonly case_sensitive?: unknown;
  readonly position?: unknown;
  readonly depth?: unknown;
  readonly role?: unknown;
  readonly match_whole_words?: unknown;
  readonly extensions?: unknown;
}

function ext(entry: LiveLoreEntry): Record<string, unknown> {
  const e = entry.extensions;
  return e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Source array position stamped by the forward mapping. The join key between a
 *  stored source entry and its live row. */
export function sourceIndexOf(entry: LiveLoreEntry): number | null {
  const idx = ext(entry)["_risu_array_index"];
  return typeof idx === "number" ? idx : null;
}

/** Leading `@@` block. The forward mapping only ever strips from the top, so
 *  everything above the first non-decorator line is the decorator set. */
function leadingDecoratorLines(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("@@")) break;
    out.push(t);
  }
  return out;
}

/** Tier-1 decorators the forward mapping folded into Lumi columns and stripped
 *  from `content`. Recovered by differencing against the source rather than
 *  re-derived from fields, so argument spelling and ordering survive.
 *  `match_whole_words: false` is the default on every projected entry, so a
 *  field-derived guess would stamp `@@match_partial_word` onto entries that
 *  never carried it. */
function strippedDecorators(source: LoreBook | null, liveContent: string): string[] {
  if (!source) return [];
  const sourceLines = leadingDecoratorLines(
    typeof source.content === "string" ? source.content : "",
  );
  if (sourceLines.length === 0) return [];
  const kept = new Set(leadingDecoratorLines(liveContent));
  return sourceLines.filter((l) => !kept.has(l));
}

/** Only for entries with no source counterpart. Emits a decorator solely when
 *  the field departs from the value the forward mapping defaults to. */
function decoratorsFromLiveFields(entry: LiveLoreEntry): string[] {
  const out: ParsedDecorator[] = [];
  const push = (name: string, args: string[]): void => {
    out.push({ name, args, isFallback: false, lineIndex: 0 });
  };
  const depth = entry.depth;
  if (typeof depth === "number" && depth > 0) push("depth", [String(depth)]);
  const role = entry.role;
  if (typeof role === "string" && role.length > 0) push("role", [role]);
  if (entry.match_whole_words === true) push("match_full_word", []);
  return out.map(serializeDecorator);
}

/** Project a live Lumi row back to Risu's LoreBook shape. `source` supplies the
 *  fields Lumi has no column for (mode, folder, entry id, lore cache). */
export function liveEntryToRisuLore(
  entry: LiveLoreEntry,
  source: LoreBook | null,
): LoreBook {
  const e = ext(entry);
  const stashedExtentions = e["risu_extentions"];
  const caseSensitive = entry.case_sensitive === true;

  const extentions: Record<string, unknown> =
    stashedExtentions && typeof stashedExtentions === "object" && !Array.isArray(stashedExtentions)
      ? { ...(stashedExtentions as Record<string, unknown>) }
      : {};
  if (caseSensitive) extentions["risu_case_sensitive"] = true;
  else delete extentions["risu_case_sensitive"];

  const mode = typeof e["risu_mode"] === "string"
    ? (e["risu_mode"] as LoreBook["mode"])
    : (entry.constant === true ? "constant" : "normal");

  const rawContent = typeof entry.content === "string" ? entry.content : "";
  const decorators = source
    ? strippedDecorators(source, rawContent)
    : decoratorsFromLiveFields(entry);
  const content = decorators.length > 0
    ? `${decorators.join("\n")}\n${rawContent}`
    : rawContent;

  const built: Record<string, unknown> = {
    key: strArray(entry.key).join(", "),
    secondkey: strArray(entry.keysecondary).join(", "),
    insertorder: typeof entry.order_value === "number" ? entry.order_value : (source?.insertorder ?? 100),
    comment: typeof entry.comment === "string" ? entry.comment : "",
    content,
    mode,
    alwaysActive: entry.constant === true,
    selective: entry.selective === true,
    extentions,
    useRegex: entry.use_regex === true,
  };
  if (entry.use_probability === true && typeof entry.probability === "number") {
    built["activationPercent"] = entry.probability;
  }
  if (typeof e["risu_entry_id"] === "string") built["id"] = e["risu_entry_id"];
  else if (source?.id !== undefined) built["id"] = source.id;
  if (typeof e["risu_folder"] === "string") built["folder"] = e["risu_folder"];
  else if (source?.folder !== undefined) built["folder"] = source.folder;
  if (e["risu_lore_cache"] !== undefined) built["loreCache"] = e["risu_lore_cache"];
  else if (source?.loreCache !== undefined) built["loreCache"] = source.loreCache;
  if (typeof e["risu_book_version"] === "number") built["bookVersion"] = e["risu_book_version"];

  return built as unknown as LoreBook;
}

export interface LoreReconcileResult {
  readonly entries: readonly LoreBook[];
  /** Live rows with no stored source counterpart. */
  readonly added: number;
  /** Source entries whose live row was deleted. */
  readonly removed: number;
  /** Live rows that diverged from what the source re-projects to. */
  readonly edited: number;
}

/** Fields the forward mapping derives from source. A difference in any of them
 *  means the user touched the row, so its source copy is no longer authoritative. */
const COMPARED_FIELDS: readonly (keyof LumiWorldBookEntry)[] = [
  "key", "keysecondary", "content", "comment", "order_value",
  "constant", "selective", "probability", "use_probability",
  "use_regex", "case_sensitive", "position", "depth", "role",
  "match_whole_words", "disabled",
];

function sameField(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function reconcileLoreEntries(
  sourceEntries: readonly LoreBook[],
  liveEntries: readonly LiveLoreEntry[],
  uuid: () => string,
): LoreReconcileResult {
  const folders = new Map<string, string>();
  for (const s of sourceEntries) {
    if (s.mode === "folder" && s.id) folders.set(s.id, s.comment || "");
  }

  const liveBySourceIndex = new Map<number, LiveLoreEntry>();
  const orphans: LiveLoreEntry[] = [];
  for (const live of liveEntries) {
    const idx = sourceIndexOf(live);
    if (idx !== null && !liveBySourceIndex.has(idx)) liveBySourceIndex.set(idx, live);
    else orphans.push(live);
  }

  const out: LoreBook[] = [];
  let edited = 0;
  let removed = 0;

  for (let i = 0; i < sourceEntries.length; i++) {
    const source = sourceEntries[i]!;
    const live = liveBySourceIndex.get(i);
    if (!live) {
      removed += 1;
      continue;
    }
    const projected = mapLoreBookEntryWithStats(source, "", folders, 0, uuid, i).entry as unknown as Record<string, unknown>;
    const untouched = COMPARED_FIELDS.every(
      (f) => sameField(projected[f as string], (live as unknown as Record<string, unknown>)[f as string]),
    );
    out.push(untouched ? source : liveEntryToRisuLore(live, source));
    if (!untouched) edited += 1;
  }

  for (const live of orphans) {
    out.push(liveEntryToRisuLore(live, null));
  }

  return { entries: out, added: orphans.length, removed, edited };
}
