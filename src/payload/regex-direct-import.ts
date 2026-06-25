// Risu parity: parse a standalone regex export file and project to Risu's
// customscript[] shape. Mirrors Risu's importRegex (process/scripts.ts) +
// the module-import regex branch (process/modules.ts).

import { customscriptSchema, type CustomScript } from '../core/schemas/customscript.js';

export interface DirectRegexParse {
  readonly scripts: readonly CustomScript[];
  // Elements the source shipped that we couldn't coerce to a customscript.
  readonly dropped: number;
  readonly format: 'risu' | 'array' | 'unknown';
}

function coerceList(raw: unknown[]): { scripts: CustomScript[]; dropped: number } {
  const scripts: CustomScript[] = [];
  let dropped = 0;
  for (const e of raw) {
    const parsed = customscriptSchema.safeParse(e);
    if (parsed.success) scripts.push(parsed.data);
    else dropped += 1;
  }
  return { scripts, dropped };
}

/**
 * Parse a JSON string expected to be one of:
 *   - Risu native: `{ type: 'regex', data: customscript[] }` (exportRegex)
 *   - bare array: `[customscript, ...]`
 *   - `{ regex: [...] }` (module-shaped export)
 */
export function parseDirectRegex(json: string): DirectRegexParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { scripts: [], dropped: 0, format: 'unknown' };
  }

  if (Array.isArray(parsed)) {
    const { scripts, dropped } = coerceList(parsed);
    return { scripts, dropped, format: 'array' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { scripts: [], dropped: 0, format: 'unknown' };
  }
  const obj = parsed as Record<string, unknown>;

  // Risu native shape.
  if (obj['type'] === 'regex' && Array.isArray(obj['data'])) {
    const { scripts, dropped } = coerceList(obj['data'] as unknown[]);
    return { scripts, dropped, format: 'risu' };
  }

  // Module-shaped export carrying a regex array.
  if (Array.isArray(obj['regex'])) {
    const { scripts, dropped } = coerceList(obj['regex'] as unknown[]);
    return { scripts, dropped, format: 'risu' };
  }

  return { scripts: [], dropped: 0, format: 'unknown' };
}
