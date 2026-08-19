import type { LumiRegexScript } from '../core/lumiverse/types.js';
import type { StoredRegexScript } from './types.js';

export type ProjectedCharacterRegexScript = StoredRegexScript & {
  readonly metadata: Readonly<Record<string, unknown>>;
};

export const INVALID_SOURCE_REGEX_KEY = '_lr_invalid_source_regex';

// Same never-match pattern the translator emits for divider rows.
const NEVER_MATCH_PATTERN = '(?!)';
const SAFE_FLAGS = 'g';

function hasMacroSyntax(pattern: string): boolean {
  return pattern.includes('{{')
    || pattern.includes('<USER>')
    || pattern.includes('<BOT>')
    || pattern.includes('<CHAR>');
}

/**
 * Mirrors Lumiverse's create-time validateRegex, including its macro
 * pre-substitution. Compiling the raw pattern instead would reject rules that
 * only become valid once macros resolve.
 */
export function hostRegexCompileError(
  findRegex: string,
  flags: string,
  substituteMacros: string,
): string | null {
  const pattern = substituteMacros !== 'none' && hasMacroSyntax(findRegex)
    ? findRegex.replace(/\{\{[\s\S]*?\}\}/g, 'x').replace(/<USER>|<BOT>|<CHAR>/g, 'x')
    : findRegex;
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Cards ship rules that no engine can compile (Risu swallows the error, so
 * authors never notice). The host rejects them on create, which would fail the
 * whole install and pin the character below the failing migration forever.
 * Park them as visible, disabled, never-matching rows instead of dropping them.
 */
export function neutralizeUncompilableRegex(
  row: ProjectedCharacterRegexScript,
): { readonly row: ProjectedCharacterRegexScript; readonly error: string | null } {
  const error = hostRegexCompileError(row.find_regex, row.flags, row.substitute_macros);
  if (error === null) return { row, error: null };
  return {
    row: {
      ...row,
      find_regex: NEVER_MATCH_PATTERN,
      flags: SAFE_FLAGS,
      disabled: true,
      description: `Disabled: source card regex does not compile (${error}).`,
      metadata: {
        ...row.metadata,
        [INVALID_SOURCE_REGEX_KEY]: {
          find_regex: row.find_regex,
          flags: row.flags,
          error,
        },
      },
    },
    error,
  };
}

/**
 * Rebinds translator-generated character rows to the real Lumiverse character.
 * Fresh import and in-place re-translation must use the same projection.
 */
export function projectCharacterRegexScripts(
  rows: readonly LumiRegexScript[],
  characterId: string,
  characterName: string,
): ProjectedCharacterRegexScript[] {
  const fallbackFolder = `Risu — ${characterName}`.slice(0, 80);
  return rows.map((row) => neutralizeUncompilableRegex({
    name: row.name,
    script_id: row.script_id,
    find_regex: row.find_regex,
    replace_string: row.replace_string,
    flags: row.flags,
    placement: [...row.placement],
    scope: row.scope,
    scope_id: row.scope === 'character' ? characterId : row.scope_id,
    target: row.target,
    min_depth: row.min_depth,
    max_depth: row.max_depth,
    trim_strings: [...row.trim_strings],
    run_on_edit: row.run_on_edit,
    substitute_macros: row.substitute_macros,
    disabled: row.disabled,
    sort_order: row.sort_order,
    description: row.description,
    folder: row.folder || fallbackFolder,
    metadata: { ...(row.metadata ?? {}) },
  }).row);
}
