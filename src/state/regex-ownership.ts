import type { SpindleAPI } from 'lumiverse-spindle-types';

import type { PendingRegexScriptMsg } from '../types/messages.js';

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;

type MutableRegexInput = Parameters<RegexApi['create']>[0];
type ListedRegex = Awaited<ReturnType<RegexApi['list']>>['data'][number];

export type RegexOwnershipStage = 'duplicate_id' | 'list' | 'update' | 'create' | 'unowned';

export interface RegexOwnershipFailure {
  readonly scriptId: string;
  readonly name: string;
  readonly stage: RegexOwnershipStage;
  readonly message: string;
}

export interface RegexOwnershipResult {
  readonly scripts: readonly PendingRegexScriptMsg[];
  readonly allOwned: boolean;
  readonly created: number;
  readonly alreadyOwned: number;
  readonly unowned: number;
  readonly failed: number;
  readonly failures: readonly RegexOwnershipFailure[];
  /** Row ids blocked by host ownership. Each one shadows a desired script_id,
   *  so deleting them is recoverable: a re-run recreates them as owned rows. */
  readonly unownedRowIds: readonly string[];
}

const MAX_DESCRIBED_FAILURES = 5;

/** Compact, host-error-preserving summary for throw sites and logs. */
export function describeRegexOwnershipFailures(
  failures: readonly RegexOwnershipFailure[],
): string {
  if (failures.length === 0) return '';
  const shown = failures.slice(0, MAX_DESCRIBED_FAILURES).map(
    (f) => `${f.stage}:${f.scriptId || '<empty-id>'}("${f.name}") ${f.message}`,
  );
  const rest = failures.length - shown.length;
  return shown.join('; ') + (rest > 0 ? `; +${rest} more` : '');
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function normalizeScriptId(raw: string): string {
  return raw.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function scopeKey(script: PendingRegexScriptMsg): string {
  return `${script.scope}\u0000${script.scope_id ?? ''}`;
}

async function listScope(
  api: RegexApi,
  script: PendingRegexScriptMsg,
  userId: string,
): Promise<Map<string, ListedRegex>> {
  const rows = new Map<string, ListedRegex>();
  let offset = 0;
  while (true) {
    const page = await api.list({
      scope: script.scope,
      ...(script.scope_id === null ? {} : { scopeId: script.scope_id }),
      limit: 200,
      offset,
      userId,
    });
    for (const row of page.data) {
      if (row.script_id) rows.set(row.script_id, row);
    }
    if (page.data.length < 200) break;
    offset += page.data.length;
  }
  return rows;
}

function createInput(script: PendingRegexScriptMsg): MutableRegexInput {
  return {
    ...script,
    placement: [...script.placement],
    trim_strings: [...script.trim_strings],
    metadata: { ...script.metadata },
  } as MutableRegexInput;
}

/**
 * Creates missing owned rows and refreshes rows already owned by this
 * extension. Existing unowned rows are never modified or deleted; callers
 * must keep cleanup disabled.
 */
export async function ensureRegexOwnership(
  api: RegexApi,
  scripts: readonly PendingRegexScriptMsg[],
  userId: string,
): Promise<RegexOwnershipResult> {
  const normalizedScripts = scripts.map((script) => ({
    ...script,
    script_id: normalizeScriptId(script.script_id),
  }));
  const rowsByScope = new Map<string, Map<string, ListedRegex>>();
  const seen = new Set<string>();
  const failures: RegexOwnershipFailure[] = [];
  const unownedRowIds: string[] = [];
  let created = 0;
  let alreadyOwned = 0;
  let unowned = 0;

  const fail = (
    script: PendingRegexScriptMsg,
    stage: RegexOwnershipStage,
    message: string,
  ): void => {
    failures.push({ scriptId: script.script_id, name: script.name, stage, message });
  };

  for (const script of normalizedScripts) {
    if (!script.script_id || seen.has(script.script_id)) {
      fail(
        script,
        'duplicate_id',
        script.script_id ? 'normalized script_id collides with an earlier row' : 'empty script_id',
      );
      continue;
    }
    seen.add(script.script_id);

    const key = scopeKey(script);
    let existingById = rowsByScope.get(key);
    if (!existingById) {
      try {
        existingById = await listScope(api, script, userId);
        rowsByScope.set(key, existingById);
      } catch (err) {
        fail(script, 'list', errText(err));
        continue;
      }
    }

    const existing = existingById.get(script.script_id);
    if (existing) {
      if (existing.can_mutate !== true) {
        unowned++;
        unownedRowIds.push(existing.id);
        fail(script, 'unowned', `row ${existing.id} is not mutable by this extension`);
        continue;
      }
      try {
        await api.update(existing.id, createInput(script), userId);
        alreadyOwned++;
      } catch (err) {
        fail(script, 'update', errText(err));
      }
      continue;
    }

    try {
      const createdRow = await api.create(createInput(script), userId);
      created++;
      existingById.set(script.script_id, createdRow);
    } catch (err) {
      fail(script, 'create', errText(err));
    }
  }

  // `unowned` rows are counted in both places, so subtract to keep `failed`
  // meaning what it did before this returned per-row detail.
  const failed = failures.length - unowned;

  return {
    scripts: normalizedScripts,
    allOwned: unowned === 0 && failed === 0,
    created,
    alreadyOwned,
    unowned,
    failed,
    failures,
    unownedRowIds,
  };
}
