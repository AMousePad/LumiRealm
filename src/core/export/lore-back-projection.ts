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
  readonly scan_depth?: unknown;
  readonly priority?: unknown;
  readonly prevent_recursion?: unknown;
  readonly exclude_recursion?: unknown;
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

/** Every Tier-1 field, its default after projection, and how to spell it as a
 *  decorator. Fields absent from Lumi's schema are not listed: those stay in
 *  whatever the source said. */
interface Tier1Field {
  readonly key: keyof LiveLoreEntry;
  /** Value the forward mapping produces when no decorator set it. */
  readonly dflt: unknown;
  /** Decorator names that set this field, so a stale one can be dropped. */
  readonly owns: readonly string[];
  readonly emit: (v: unknown, entry: LiveLoreEntry) => string[] | null;
}

const TIER1_FIELDS: readonly Tier1Field[] = [
  {
    key: "depth", dflt: 0, owns: ["depth", "reverse_depth", "end", "position"],
    // position=4 is what @@depth/@@end produce; anything else is a position
    // decorator's doing and is handled by the position field below.
    emit: (v, e) => (typeof v === "number" && e.position === 4 ? ["depth", String(v)] : null),
  },
  {
    key: "position", dflt: 0, owns: ["position"],
    emit: (v) => (v === 0 ? null : v === 1 ? ["position", "after_desc"] : null),
  },
  { key: "role", dflt: null, owns: ["role"],
    emit: (v) => (typeof v === "string" && v.length > 0 ? ["role", v] : null) },
  { key: "scan_depth", dflt: null, owns: ["scan_depth"],
    emit: (v) => (typeof v === "number" ? ["scan_depth", String(v)] : null) },
  { key: "priority", dflt: 0, owns: ["priority", "ignore_on_max_context"],
    emit: (v) => (typeof v === "number" && v !== 0 ? ["priority", String(v)] : null) },
  { key: "probability", dflt: 100, owns: ["probability"],
    emit: (v, e) => (e.use_probability === true && typeof v === "number" ? ["probability", String(v)] : null) },
  { key: "match_whole_words", dflt: false, owns: ["match_full_word", "match_partial_word"],
    emit: (v) => (v === true ? ["match_full_word"] : v === false ? null : null) },
  { key: "prevent_recursion", dflt: false, owns: ["unrecursive", "recursive"],
    emit: (v) => (v === true ? ["unrecursive"] : null) },
  { key: "exclude_recursion", dflt: false, owns: ["no_recursive_search"],
    emit: (v) => (v === true ? ["no_recursive_search"] : null) },
  { key: "disabled", dflt: false, owns: ["dont_activate"],
    emit: (v) => (v === true ? ["dont_activate"] : null) },
];

function decoratorName(line: string): string {
  const body = line.replace(/^@@@?/, "");
  const sp = body.indexOf(" ");
  return (sp < 0 ? body : body.slice(0, sp)).trim();
}

/** Rebuilds the Tier-1 decorator block the forward mapping stripped out.
 *
 *  Live values win on every field, so a Lumiverse edit to depth / role /
 *  probability / recursion survives the export. A field the user left alone
 *  re-emits its source line verbatim, which keeps argument spelling
 *  (`@@reverse_depth`, `@@ignore_on_max_context`) that a canonical re-derive
 *  would flatten. `match_whole_words: false` is the post-projection default on
 *  every entry, so it only emits when the source said so explicitly. */
function tier1Decorators(entry: LiveLoreEntry, source: LoreBook | null, projected: Record<string, unknown> | null): string[] {
  const sourceLines = source
    ? leadingDecoratorLines(typeof source.content === "string" ? source.content : "")
    : [];
  const liveKept = new Set(leadingDecoratorLines(
    typeof entry.content === "string" ? entry.content : "",
  ));
  // Only lines the forward mapping consumed. Ones still inline in live content
  // are Tier 2/3 and must not be duplicated.
  const stripped = sourceLines.filter((l) => !liveKept.has(l));

  const out: string[] = [];
  const consumed = new Set<string>();
  for (const f of TIER1_FIELDS) {
    const liveVal = (entry as Record<string, unknown>)[f.key as string];
    const projVal = projected ? projected[f.key as string] : undefined;
    const unchanged = projected !== null && sameField(liveVal, projVal);
    for (const n of f.owns) consumed.add(n);
    if (unchanged) {
      // Re-emit whatever the source spelled for this field.
      out.push(...stripped.filter((l) => f.owns.includes(decoratorName(l))));
      continue;
    }
    if (sameField(liveVal, f.dflt)) continue;
    const spec = f.emit(liveVal, entry);
    if (spec) {
      const [name, ...args] = spec;
      out.push(serializeDecorator({ name: name!, args, isFallback: false, lineIndex: 0 } as ParsedDecorator));
    }
  }
  // Stripped decorators for fields Lumi never modelled (additional_keys, the
  // constant-setting @@activate, ...) pass through untouched.
  for (const l of stripped) {
    if (!consumed.has(decoratorName(l)) && !out.includes(l)) out.push(l);
  }
  return [...new Set(out)];
}

/** Project a live Lumi row back to Risu's LoreBook shape. `source` supplies the
 *  fields Lumi has no column for (mode, folder, entry id, lore cache). */
export function liveEntryToRisuLore(
  entry: LiveLoreEntry,
  source: LoreBook | null,
  projected: Record<string, unknown> | null = null,
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
  const decorators = tier1Decorators(entry, source, projected);
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
    out.push(untouched ? source : liveEntryToRisuLore(live, source, projected));
    if (!untouched) edited += 1;
  }

  for (const live of orphans) {
    out.push(liveEntryToRisuLore(live, null, null));
  }

  return { entries: out, added: orphans.length, removed, edited };
}
