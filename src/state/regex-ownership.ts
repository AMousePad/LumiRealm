import type { SpindleAPI } from 'lumiverse-spindle-types';

import type { PendingRegexScriptMsg } from '../types/messages.js';

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;

type MutableRegexInput = Parameters<RegexApi['create']>[0];

interface ListedRegex {
  readonly id: string;
  readonly script_id: string;
  readonly can_mutate?: boolean;
}

export interface RegexOwnershipResult {
  readonly scripts: readonly PendingRegexScriptMsg[];
  readonly allOwned: boolean;
  readonly created: number;
  readonly alreadyOwned: number;
  readonly unowned: number;
  readonly failed: number;
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
    for (const row of page.data as readonly ListedRegex[]) {
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
  let created = 0;
  let alreadyOwned = 0;
  let unowned = 0;
  let failed = 0;

  for (const script of normalizedScripts) {
    if (!script.script_id || seen.has(script.script_id)) {
      failed++;
      continue;
    }
    seen.add(script.script_id);

    const key = scopeKey(script);
    let existingById = rowsByScope.get(key);
    if (!existingById) {
      try {
        existingById = await listScope(api, script, userId);
        rowsByScope.set(key, existingById);
      } catch {
        failed++;
        continue;
      }
    }

    const existing = existingById.get(script.script_id);
    if (existing) {
      if (existing.can_mutate !== true) {
        unowned++;
        continue;
      }
      try {
        await api.update(existing.id, createInput(script), userId);
        alreadyOwned++;
      } catch {
        failed++;
      }
      continue;
    }

    try {
      const createdRow = await api.create(createInput(script), userId);
      created++;
      existingById.set(script.script_id, {
        id: createdRow.id,
        script_id: script.script_id,
        can_mutate: true,
      });
    } catch {
      failed++;
    }
  }

  return {
    scripts: normalizedScripts,
    allOwned: unowned === 0 && failed === 0,
    created,
    alreadyOwned,
    unowned,
    failed,
  };
}
