// Handler dispatch table. Names normalised per Risu parser.svelte.ts.

import "../../risu-compat/handlers/index.js";
import { registry } from "../../risu-compat/registry.js";
import {
  normalizeMacroName,
  CatalogIndex,
  parseCatalog,
} from "../../core/cbs/index.js";
import catalogJson from "../../core/cbs/catalog/risu-macros.json";

import type { MacroHandler } from "./types.js";
import { registerBuiltins } from "./builtins.js";

export interface DispatchEntry {
  readonly handler: MacroHandler;
  readonly scoped: boolean;
  readonly name: string;
}

const table = new Map<string, DispatchEntry>();
let initialised = false;

function strip(name: string): string {
  return normalizeMacroName(name);
}

function registerInto(
  name: string,
  handler: MacroHandler,
  scoped: boolean,
): void {
  const key = strip(name);
  if (!key) return;
  if (!table.has(key)) {
    table.set(key, { handler, scoped, name });
  }
}

function init(): void {
  if (initialised) return;
  initialised = true;

  // 1. Risu-compat handlers use the exact names accepted by RisuAI.
  for (const reg of registry.entries()) {
    registerInto(reg.name, reg.handler, reg.scoped);
  }

  // 2. Catalog aliases (Risu cbs.ts).
  try {
    const catalog = new CatalogIndex(parseCatalog(catalogJson as unknown));
    for (const entry of catalog.entries) {
      if (!entry.aliases || entry.aliases.length === 0) continue;
      const canonicalKey = strip(entry.name);
      const primary = table.get(canonicalKey);
      if (!primary) continue;
      for (const alias of entry.aliases) {
        if (typeof alias !== "string" || alias.length === 0) continue;
        registerInto(alias, primary.handler, primary.scoped);
      }
    }
  } catch {
    // Catalog parse failure; aliases won't resolve but primary names still work.
  }

  // 3. Lumi-native mirrors (./builtins). Registered last; fills only unclaimed names.
  registerBuiltins((name, handler, scoped) => {
    registerInto(name, handler, scoped);
  });
}

export function lookup(name: string): DispatchEntry | null {
  if (!initialised) init();
  return table.get(strip(name)) ?? null;
}

export function ensureInitialised(): void {
  if (!initialised) init();
}

export function registeredCount(): number {
  if (!initialised) init();
  return table.size;
}
