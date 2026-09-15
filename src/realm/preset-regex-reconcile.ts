import type {
  RegexScriptCreateDTO,
  RegexScriptDTO,
  SpindleAPI,
} from 'lumiverse-spindle-types';

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;

const PAGE_SIZE = 200;
const MAX_STALE_SAMPLE = 5;

/**
 * The substantive columns of one imported rule. Two rows sharing a key are the
 * same rule, so a re-import matches the row a previous import created instead
 * of inserting another one. Labels, sort order, and the enable switch are
 * projection state and stay out of the key: the user owns them once a row
 * exists.
 */
export interface PresetRuleFields {
  readonly find_regex: string;
  readonly replace_string?: string;
  readonly flags?: string;
  readonly placement?: readonly string[];
  readonly target?: string;
  readonly scope?: string;
  readonly scope_id?: string | null;
  readonly min_depth?: number | null;
  readonly max_depth?: number | null;
  readonly trim_strings?: readonly string[];
  readonly run_on_edit?: boolean;
  readonly substitute_macros?: string;
}

export function presetRuleKey(rule: PresetRuleFields): string {
  return JSON.stringify([
    rule.find_regex,
    rule.replace_string ?? '',
    rule.flags ?? '',
    [...(rule.placement ?? [])].sort(),
    rule.target ?? '',
    rule.scope ?? '',
    rule.scope_id ?? null,
    rule.min_depth ?? null,
    rule.max_depth ?? null,
    [...(rule.trim_strings ?? [])],
    rule.run_on_edit === true,
    rule.substitute_macros ?? '',
  ]);
}

export interface PresetRegexReconcileDeps {
  readonly api: RegexApi;
  readonly userId: string;
  /** Preset name, which is also the regex folder the importer writes. */
  readonly presetName: string;
  readonly rules: readonly RegexScriptCreateDTO[];
  readonly log?: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
  };
  readonly errMsg: (err: unknown) => string;
}

export interface PresetRegexReconcileResult {
  /** Rows already in this preset's folder that this extension may mutate. */
  readonly managed: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Managed rows no incoming rule matched. Left in place, reported only. */
  readonly staleKept: number;
  readonly failed: number;
  readonly listFailed: boolean;
}

function oldestFirst(a: RegexScriptDTO, b: RegexScriptDTO): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Rows this extension owns inside one preset's folder, oldest first. */
async function listManagedRows(
  api: RegexApi,
  presetName: string,
  userId: string,
): Promise<RegexScriptDTO[]> {
  const rows: RegexScriptDTO[] = [];
  let offset = 0;
  while (true) {
    const page = await api.list({ scope: 'global', limit: PAGE_SIZE, offset, userId });
    for (const row of page.data) {
      // `can_mutate` is the host's ownership verdict: host rows and rows owned
      // by another extension stay untouched even when they share the folder.
      if (row.can_mutate === true && row.folder === presetName && row.scope === 'global') {
        rows.push(row);
      }
    }
    if (page.data.length < PAGE_SIZE) break;
    offset += page.data.length;
  }
  // Deterministic survivor: among duplicates of one rule the oldest row wins.
  rows.sort(oldestFirst);
  return rows;
}

/**
 * Idempotent install of one preset's regex rows. Matching managed rows are
 * reused, unmatched managed rows are left alone, and only genuinely new rules
 * are created. Every rule still reaches the host, so a rule that disappeared
 * from the archive is never deleted on the user's behalf.
 */
export async function reconcilePresetRegexScripts(
  deps: PresetRegexReconcileDeps,
): Promise<PresetRegexReconcileResult> {
  const { api, userId, presetName, rules, log, errMsg } = deps;

  let managed: RegexScriptDTO[] = [];
  let listFailed = false;
  try {
    managed = await listManagedRows(api, presetName, userId);
  } catch (err) {
    // A read failure must not block the import, and must not be silent: rows
    // land unmanaged and the next import re-matches them.
    listFailed = true;
    log?.warn(
      `preset regex: list failed folder="${presetName}", importing without matching: ${errMsg(err)}`,
    );
  }

  const available = new Map<string, RegexScriptDTO[]>();
  for (const row of managed) {
    const key = presetRuleKey(row);
    const bucket = available.get(key);
    if (bucket) bucket.push(row);
    else available.set(key, [row]);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const rule of rules) {
    const existing = available.get(presetRuleKey(rule))?.shift();
    if (!existing) {
      try {
        await api.create(rule, userId);
        created++;
      } catch (err) {
        failed++;
        log?.warn(`preset regex: create failed for "${rule.name}": ${errMsg(err)}`);
      }
      continue;
    }
    // Matched row: only the archive's sort order is refreshed, so repeated
    // imports cannot reorder the folder. Label, metadata, and the user's
    // enable switch stay as they are.
    const sortOrder = rule.sort_order;
    if (sortOrder === undefined || existing.sort_order === sortOrder) {
      unchanged++;
      continue;
    }
    try {
      await api.update(existing.id, { sort_order: sortOrder }, userId);
      updated++;
    } catch (err) {
      failed++;
      log?.warn(`preset regex: update failed for row ${existing.id}: ${errMsg(err)}`);
    }
  }

  const sample: string[] = [];
  let staleKept = 0;
  for (const bucket of available.values()) {
    for (const row of bucket) {
      staleKept++;
      if (sample.length < MAX_STALE_SAMPLE) sample.push(`${row.id}("${row.name}")`);
    }
  }
  if (staleKept > 0) {
    log?.warn(
      `preset regex: folder="${presetName}" kept ${staleKept} unmatched row(s) ` +
        `[${sample.join(', ')}${staleKept > sample.length ? ', ...' : ''}]`,
    );
  }

  return {
    managed: managed.length,
    created,
    updated,
    unchanged,
    staleKept,
    failed,
    listFailed,
  };
}
