import type { PendingRegexScriptMsg } from '../types/messages.js';

export interface RegexCleanupRow {
  readonly id: string;
  readonly script_id?: string;
  readonly scope?: string;
  readonly scope_id?: string | null;
  readonly metadata?: {
    readonly _risu?: {
      readonly module_id?: string;
      readonly imported_regex?: boolean;
      readonly origin?: string;
    };
  };
}

export interface RegexCleanupPlan {
  readonly verified: boolean;
  readonly staleIds: readonly string[];
}

function desiredIds(scripts: readonly PendingRegexScriptMsg[]): Set<string> {
  return new Set(scripts.map((script) => script.script_id).filter(Boolean));
}

function replacementsExist(rows: readonly RegexCleanupRow[], desired: Set<string>): boolean {
  const live = new Set(rows.map((row) => row.script_id).filter((id): id is string => !!id));
  return [...desired].every((id) => live.has(id));
}

export function planCardRegexCleanup(
  rows: readonly RegexCleanupRow[],
  characterId: string,
  scripts: readonly PendingRegexScriptMsg[],
): RegexCleanupPlan {
  const scoped = rows.filter(
    (row) => row.scope === 'character' && row.scope_id === characterId,
  );
  const desired = desiredIds(scripts);
  if (!replacementsExist(scoped, desired)) return { verified: false, staleIds: [] };
  return {
    verified: true,
    staleIds: scoped
      .filter((row) =>
        (row.metadata?._risu?.origin === 'character'
          || row.metadata?._risu?.origin === 'module')
        &&
        !row.metadata?._risu?.module_id
        && !row.metadata?._risu?.imported_regex
        && !desired.has(row.script_id ?? ''),
      )
      .map((row) => row.id),
  };
}

export function planModuleRegexCleanup(
  rows: readonly RegexCleanupRow[],
  moduleId: string,
  scripts: readonly PendingRegexScriptMsg[],
): RegexCleanupPlan {
  const moduleRows = rows.filter((row) => row.metadata?._risu?.module_id === moduleId);
  const desired = desiredIds(scripts);
  if (!replacementsExist(moduleRows, desired)) return { verified: false, staleIds: [] };
  return {
    verified: true,
    staleIds: moduleRows
      .filter((row) => !desired.has(row.script_id ?? ''))
      .map((row) => row.id),
  };
}
