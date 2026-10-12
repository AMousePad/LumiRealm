import { macroCatalogSchema, type MacroCatalog, type MacroCatalogEntry, isComplete } from "./schema.js";
import { normalizeMacroName } from "../normalize.js";

export class CatalogIndex {
  private readonly entriesByCanonical = new Map<string, MacroCatalogEntry>();
  /** All names that map to each entry — canonical plus normalized aliases. */
  private readonly entriesByLookup = new Map<string, MacroCatalogEntry>();
  readonly entries: readonly MacroCatalogEntry[];

  constructor(entries: readonly MacroCatalogEntry[]) {
    this.entries = entries;
    for (const e of entries) {
      // Strip "#"/":" block markers so a MacroNode with name === "if" still finds the entry.
      const canonical = stripBlockMarker(e.name);
      if (this.entriesByCanonical.has(canonical)) {
        throw new Error(`catalog: duplicate canonical name "${canonical}"`);
      }
      this.entriesByCanonical.set(canonical, e);
      const canonicalNorm = normalizeMacroName(canonical);
      this.entriesByLookup.set(canonicalNorm, e);
      for (const alias of e.aliases) {
        const norm = normalizeMacroName(stripBlockMarker(alias));
        // alias collisions: first-wins (matches Risu registration-order behavior)
        if (!this.entriesByLookup.has(norm)) this.entriesByLookup.set(norm, e);
      }
    }
  }

  find(name: string): MacroCatalogEntry | null {
    const norm = normalizeMacroName(stripBlockMarker(name));
    return this.entriesByLookup.get(norm) ?? null;
  }

  delegatesToLumiverse(name: string): boolean {
    const e = this.find(name);
    return !!e && !!e.lumiverseCollision && e.lumiverseCollision.compatible;
  }

  /** True if the macro collides with a Lumiverse built-in with incompatible semantics. */
  needsRename(name: string): boolean {
    const e = this.find(name);
    return !!e && !!e.lumiverseCollision && !e.lumiverseCollision.compatible;
  }

  incompatibleNames(): string[] {
    const names: string[] = [];
    for (const e of this.entries) {
      if (!e.lumiverseCollision || e.lumiverseCollision.compatible) continue;
      names.push(e.name);
      if (e.aliases) names.push(...e.aliases);
    }
    return names;
  }

  handlerEntries(): MacroCatalogEntry[] {
    return this.entries.filter(
      (e) => !e.lumiverseCollision || !e.lumiverseCollision.compatible,
    );
  }

  completeEntries(): MacroCatalogEntry[] {
    return this.entries.filter(isComplete);
  }

  skeletonEntries(): MacroCatalogEntry[] {
    return this.entries.filter((e) => !isComplete(e));
  }
}

/** Strip leading `#` or `:` block markers from catalog entry names. */
function stripBlockMarker(name: string): string {
  if (name.startsWith("#") || name.startsWith(":")) return name.slice(1);
  return name;
}

export function parseCatalog(raw: unknown): MacroCatalog {
  return macroCatalogSchema.parse(raw);
}

export function loadCatalog(raw: unknown): CatalogIndex {
  return new CatalogIndex(parseCatalog(raw));
}
