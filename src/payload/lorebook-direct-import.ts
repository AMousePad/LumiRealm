// Risu parity: parse a standalone lorebook JSON file (Risu native or CCSv3)
// and project to Risu's loreBook[] shape. Mirrors Risu's importLoreBook and
// convertExternalLorebook.

import type { LoreBook } from '../core/schemas/lorebook.js';

export interface DirectLorebookParse {
  readonly entries: readonly LoreBook[];
  /** Entries the source file shipped that we couldn't map (bad shape, etc.). */
  readonly dropped: number;
  /** Format detected from the file shape. */
  readonly format: 'risu' | 'ccsv3' | 'unknown';
}

interface CCLorebookEntry {
  key?: string[];
  keys?: string[];
  keywords?: string[];
  comment?: string;
  name?: string;
  displayName?: string;
  content?: string;
  entry?: string;
  text?: string;
  order?: number;
  priority?: number;
  contextConfig?: { budgetPriority?: number };
  constant?: boolean;
  forceActivation?: boolean;
  secondary_keys?: string[];
  selective?: boolean;
}

function joinList(arr: unknown): string {
  if (!Array.isArray(arr)) return '';
  return arr.filter((x): x is string => typeof x === 'string').join(', ');
}

function convertCCSv3Entry(raw: CCLorebookEntry): LoreBook {
  const keyJoined =
    joinList(raw.key) ||
    joinList(raw.keys) ||
    joinList(raw.keywords) ||
    '';
  const order =
    typeof raw.order === 'number'
      ? raw.order
      : typeof raw.priority === 'number'
        ? raw.priority
        : typeof raw.contextConfig?.budgetPriority === 'number'
          ? raw.contextConfig.budgetPriority
          : 0;
  return {
    key: keyJoined,
    secondkey: joinList(raw.secondary_keys),
    insertorder: order,
    comment:
      typeof raw.comment === 'string' && raw.comment.length > 0
        ? raw.comment
        : typeof raw.name === 'string' && raw.name.length > 0
          ? raw.name
          : typeof raw.displayName === 'string'
            ? raw.displayName
            : '',
    content:
      typeof raw.content === 'string' && raw.content.length > 0
        ? raw.content
        : typeof raw.entry === 'string' && raw.entry.length > 0
          ? raw.entry
          : typeof raw.text === 'string'
            ? raw.text
            : '',
    mode: 'normal',
    alwaysActive: raw.constant === true || raw.forceActivation === true,
    selective: raw.selective === true,
  };
}

/**
 * Parse a JSON string that's expected to be either:
 *   - Risu native: `{ type: 'risu', ver: 1, data: LoreBook[] }`
 *   - CCSv3 / TavernAI: `{ entries: Record<string, CCLorebookEntry> }`
 *
 * Returns extracted Risu-shape entries plus stats.
 */
export function parseDirectLorebook(json: string): DirectLorebookParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { entries: [], dropped: 0, format: 'unknown' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { entries: [], dropped: 0, format: 'unknown' };
  }
  const obj = parsed as Record<string, unknown>;

  // Risu native shape (lorebook.svelte.ts:678)
  if (obj['type'] === 'risu' && Array.isArray(obj['data'])) {
    const out: LoreBook[] = [];
    let dropped = 0;
    for (const e of obj['data'] as unknown[]) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        dropped += 1;
        continue;
      }
      out.push(e as LoreBook);
    }
    return { entries: out, dropped, format: 'risu' };
  }

  // CCSv3 / TavernAI shape (lorebook.svelte.ts:684 , entries is an object map)
  if (obj['entries'] && typeof obj['entries'] === 'object' && !Array.isArray(obj['entries'])) {
    const entries = obj['entries'] as Record<string, unknown>;
    const out: LoreBook[] = [];
    let dropped = 0;
    for (const k of Object.keys(entries)) {
      const e = entries[k];
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        dropped += 1;
        continue;
      }
      out.push(convertCCSv3Entry(e as CCLorebookEntry));
    }
    return { entries: out, dropped, format: 'ccsv3' };
  }

  // Bare array (some exporters do `[entry, entry, ...]` directly).
  if (Array.isArray(obj)) {
    // unreachable , array isn't object , defensive.
    return { entries: [], dropped: 0, format: 'unknown' };
  }

  return { entries: [], dropped: 0, format: 'unknown' };
}
