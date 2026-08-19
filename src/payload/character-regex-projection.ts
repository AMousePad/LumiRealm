import type { LumiRegexScript } from '../core/lumiverse/types.js';
import type { StoredRegexScript } from './types.js';

export type ProjectedCharacterRegexScript = StoredRegexScript & {
  readonly metadata: Readonly<Record<string, unknown>>;
};

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
  return rows.map((row) => ({
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
  }));
}
