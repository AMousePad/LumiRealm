// Per-version module migration registry. Steps walked sequentially, persist
// after each apply for resumability.

import type { ModuleEnvelope } from './modules-store.js';
import { unprefixCssInStyleBlocks } from '../bghtml/rewriter.js';
import { replaceStringHasPerMessageMacro } from '../core/mappers/regex.js';
import { projectModuleLorebookForCreate } from './world-book-ops.js';
import { normalizeModuleDisplayReplaceString } from './module-artifact-project.js';
import {
  LEGACY_ENTRY_HASH_FIELDS_V1,
  computeEntrySourceHashWithFields,
} from '../core/mappers/lorebook-hash.js';

export interface LiveModuleWorldBookEntry {
  readonly id: string;
  readonly exclude_greeting: boolean;
  readonly extensions: Readonly<Record<string, unknown>> | null;
}

export interface ModuleMigrationDeps {
  // syncWorldBook re-runs lorebook projection and rewrites the world_book in place.
  syncWorldBook: (env: ModuleEnvelope) => Promise<string | null>;
  reinstallArtifactsForAttached: (moduleId: string) => Promise<number>;
  // refreshArtifactsForAttached: detach + reattach for every attached character,
  // so the new projection (regex names, flags, etc.) replaces the old rows.
  refreshArtifactsForAttached?: (moduleId: string) => Promise<number>;
  repairRegexBindingsForAttached: (
    moduleId: string,
  ) => Promise<{ repaired: number; refreshed: number }>;
  // In-place patches per row, scoped to rows whose metadata._risu.module_id
  // matches. Returns null when host lacks regex_scripts.update.
  applyModuleRegexReplaceStringTransform?: (
    moduleId: string,
    transform: (replaceString: string) => string,
  ) => Promise<{ scanned: number; updated: number; failed: number } | null>;
  applyModuleRegexRowPatch?: (
    moduleId: string,
    patch: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  ) => Promise<{ scanned: number; updated: number; failed: number } | null>;
  listWorldBookEntries: (
    worldBookId: string,
  ) => Promise<readonly LiveModuleWorldBookEntry[]>;
  updateWorldBookEntryActivation: (
    entryId: string,
    input: {
      readonly exclude_greeting: boolean;
      readonly extensions: Readonly<Record<string, unknown>>;
    },
  ) => Promise<void>;
  writeEnvelope: (env: ModuleEnvelope) => Promise<void>;
  log: {
    info: (s: string) => void;
    warn: (s: string) => void;
    error: (s: string) => void;
  };
}

export interface ModuleMigrationStepArgs {
  readonly env: ModuleEnvelope;
}

export interface ModuleMigrationStepResult {
  readonly nextEnv: ModuleEnvelope;
  readonly notes: readonly string[];
}

export interface ModuleMigrationStep {
  readonly version: number;
  readonly description: string;
  readonly touches: readonly (
    | 'world_book_entries'
    | 'regex_scripts_attached_chars'
    | 'asset_index'
    | 'envelope_metadata'
  )[];
  readonly apply: (
    args: ModuleMigrationStepArgs,
    deps: ModuleMigrationDeps,
  ) => Promise<ModuleMigrationStepResult>;
}

export type ModuleMigrationResult =
  | { kind: 'noop'; storedVersion: number }
  | {
      kind: 'migrated';
      moduleId: string;
      from: number;
      to: number;
      stepsApplied: ReadonlyArray<{ version: number; notes: readonly string[] }>;
    }
  | { kind: 'failed'; moduleId: string; from: number; to: number; error: string; partialAt?: number };

// v5: pre-fix uploads projected regex with name='rule_N' (instead of Risu's
// `comment` field), prefixed with [ModuleName], and didn't strip <move_top> /
// <order N> brackets from flag (causing Lumi to reject those rules entirely).
// Detach + reattach every attached character so regex artifacts pick up the
// new projection shape.
async function applyV5RefreshAttachedRegex(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  const notes: string[] = [];
  if (deps.refreshArtifactsForAttached) {
    try {
      const refreshed = await deps.refreshArtifactsForAttached(args.env.id);
      notes.push(`refreshed ${refreshed} attached char(s)`);
    } catch (err) {
      deps.log.warn(
        `migrate-module(${args.env.id}) v5: refreshArtifactsForAttached threw: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  } else {
    notes.push('refreshArtifactsForAttached dep missing, skipping refresh');
  }
  return { nextEnv: args.env, notes };
}

async function applyV11RepairAttachedRegexIdentity(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  const result = await deps.repairRegexBindingsForAttached(args.env.id);
  return {
    nextEnv: args.env,
    notes: [
      `repaired ${result.repaired} attached char(s) in place`,
      `refreshed ${result.refreshed} incomplete attachment(s)`,
    ],
  };
}

async function applyV6StripStylePrefixInPlace(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  // Preserves user disable + edits by patching only replace_string on rows
  // where the transform actually changes the content. Falls back to wholesale
  // refresh on hosts that don't expose regex_scripts.update.
  if (!deps.applyModuleRegexReplaceStringTransform) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v6: regex_scripts.update unavailable, falling back to wholesale refresh (user disable/edit state will be lost)`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  const result = await deps.applyModuleRegexReplaceStringTransform(
    args.env.id,
    unprefixCssInStyleBlocks,
  );
  if (result === null) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v6: transform dep returned null, falling back to wholesale refresh`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  return {
    nextEnv: args.env,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV7FixPhaseMapPlacement(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  // editprocess: drop world_info (Risu chat-history-only scope). edittrans:
  // disable (no Lumi translation pipeline). editdisplay: add user_input
  // placement (the pre-fix module mapping was ai_output-only, but Risu runs
  // editdisplay on every rendered message regardless of role).
  if (!deps.applyModuleRegexRowPatch) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v7: row-patch unavailable, falling back to wholesale refresh (user disable/edit state will be lost)`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  const result = await deps.applyModuleRegexRowPatch(args.env.id, (row) => {
    const meta = row['metadata'] as { _risu?: { source_type?: unknown } } | undefined;
    const phase = meta?._risu?.source_type;
    if (typeof phase !== 'string') return null;
    if (phase === 'editprocess') {
      const placement = row['placement'];
      if (!Array.isArray(placement)) return null;
      if (!placement.includes('world_info')) return null;
      const next = (placement as string[]).filter((p) => p !== 'world_info');
      return { placement: next };
    }
    if (phase === 'edittrans') {
      const alreadyDisabled = row['disabled'] === true || row['disabled'] === 1;
      const alreadyDisplay = row['target'] === 'display';
      if (alreadyDisabled && alreadyDisplay) return null;
      return {
        disabled: true,
        target: 'display',
        placement: ['ai_output', 'user_input'],
      };
    }
    if (phase === 'editdisplay' || phase === 'disabled') {
      const placement = row['placement'];
      if (!Array.isArray(placement)) return null;
      if (placement.includes('user_input')) return null;
      const next = [...(placement as string[]), 'user_input'];
      return { placement: next };
    }
    return null;
  });
  if (result === null) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v7: row-patch returned null, falling back to wholesale refresh`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  return {
    nextEnv: args.env,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV8FixEscapedPerMessageGate(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  // Module-installed rows the projector previously set to 'escaped' but whose
  // replace_string carries a per-message {{chat_index}} gate render flakily
  // ('escaped' pre-resolves chat-wide). Re-route only those to 'after', in
  // place, so user disable + edits survive.
  if (!deps.applyModuleRegexRowPatch) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v8: row-patch unavailable, falling back to wholesale refresh (user disable/edit state will be lost)`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  const result = await deps.applyModuleRegexRowPatch(args.env.id, (row) => {
    if (row['substitute_macros'] !== 'escaped') return null;
    const rs = row['replace_string'];
    if (typeof rs !== 'string') return null;
    if (!replaceStringHasPerMessageMacro(rs)) return null;
    return { substitute_macros: 'after' };
  });
  if (result === null) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v8: row-patch returned null, falling back to wholesale refresh`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  return {
    nextEnv: args.env,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV10ExcludeGreetingPerEntry(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  const worldBookId = args.env.installed_world_book_id;
  const module = args.env.module as { lorebook?: readonly unknown[] };
  const lorebook = Array.isArray(module.lorebook) ? module.lorebook : [];
  if (!worldBookId || lorebook.length === 0) {
    return {
      nextEnv: args.env,
      notes: [worldBookId ? 'module has no lorebook entries' : 'module has no installed world book'],
    };
  }

  const projected = projectModuleLorebookForCreate(
    lorebook,
    args.env.id,
    worldBookId,
  );
  const targetBySourceHash = new Map<string, string>();
  for (const entry of projected) {
    const extensions = entry['extensions'];
    if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) continue;
    const currentHash = (extensions as Record<string, unknown>)['_risu_source_hash'];
    if (typeof currentHash !== 'string') continue;
    const legacyHash = computeEntrySourceHashWithFields(
      entry,
      LEGACY_ENTRY_HASH_FIELDS_V1,
    );
    targetBySourceHash.set(legacyHash, currentHash);
    targetBySourceHash.set(currentHash, currentHash);
  }

  const entries = await deps.listWorldBookEntries(worldBookId);
  let matched = 0;
  let updated = 0;
  let failed = 0;
  for (const entry of entries) {
    const extensions = (entry.extensions ?? {}) as Record<string, unknown>;
    if (extensions['_risu_module_id'] !== args.env.id) continue;
    const storedHash = extensions['_risu_source_hash'];
    if (typeof storedHash !== 'string') continue;
    const currentHash = targetBySourceHash.get(storedHash);
    if (!currentHash) continue;
    matched += 1;
    if (entry.exclude_greeting && storedHash === currentHash) continue;
    try {
      await deps.updateWorldBookEntryActivation(entry.id, {
        exclude_greeting: true,
        extensions: {
          ...extensions,
          _risu_source_hash: currentHash,
        },
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      deps.log.warn(
        `migrate-module(${args.env.id}) v10: update entry=${entry.id} failed: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  if (failed > 0) {
    throw new Error(`failed to update ${failed}/${matched} matched lorebook entries`);
  }
  return {
    nextEnv: args.env,
    notes: [
      `scanned=${entries.length}`,
      `matched=${matched}`,
      `updated=${updated}`,
    ],
  };
}

async function applyV12NormalizeDisplayRows(
  args: ModuleMigrationStepArgs,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationStepResult> {
  if (!deps.applyModuleRegexRowPatch) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v12: row-patch unavailable, falling back to wholesale refresh (user disable/edit state will be lost)`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  const result = await deps.applyModuleRegexRowPatch(args.env.id, (row) => {
    if (row['target'] !== 'display') return null;
    const replaceString = row['replace_string'];
    if (typeof replaceString !== 'string') return null;
    const normalized = normalizeModuleDisplayReplaceString(replaceString);
    return normalized === replaceString
      ? null
      : { replace_string: normalized };
  });
  if (result === null) {
    deps.log.warn(
      `migrate-module(${args.env.id}) v12: row-patch returned null, falling back to wholesale refresh`,
    );
    return applyV5RefreshAttachedRegex(args, deps);
  }
  return {
    nextEnv: args.env,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

export const MODULE_MIGRATIONS: readonly ModuleMigrationStep[] = [
  {
    version: 5,
    description:
      'Refresh attached-character regex artifacts to pick up new projection shape (Risu-comment names, no module-name prefix, flag-meta strip, dividers).',
    touches: ['regex_scripts_attached_chars'],
    apply: applyV5RefreshAttachedRegex,
  },
  {
    version: 6,
    description:
      'Strip x-risu- from CSS selectors inside <style> blocks of module-installed regex replace_string content. In-place per row, preserves user disable + edits.',
    touches: ['regex_scripts_attached_chars'],
    apply: applyV6StripStylePrefixInPlace,
  },
  {
    version: 7,
    description:
      'Patch placement on Risu editprocess rows (drop world_info), disable Risu edittrans rows, add user_input placement to editdisplay rows.',
    touches: ['regex_scripts_attached_chars'],
    apply: applyV7FixPhaseMapPlacement,
  },
  {
    version: 8,
    description:
      "Re-route module 'escaped' regex rows whose replace_string has a per-message {{chat_index}} gate to 'after'. In-place per row, preserves user disable + edits.",
    touches: ['regex_scripts_attached_chars'],
    apply: applyV8FixEscapedPerMessageGate,
  },
  // v9 was persisted by the rolled-back prompt-wide greeting migration.
  // Keep it burned so modules touched by that build run the corrected step.
  {
    version: 10,
    description:
      'Mark each projected Risu module lorebook entry to exclude the character greeting during activation.',
    touches: ['world_book_entries'],
    apply: applyV10ExcludeGreetingPerEntry,
  },
  {
    version: 11,
    description:
      'Repair attached module regex action bindings using module source-row order.',
    touches: ['regex_scripts_attached_chars'],
    apply: applyV11RepairAttachedRegexIdentity,
  },
  {
    version: 12,
    description:
      'Apply the character display-row normalization path to module display rows.',
    touches: ['regex_scripts_attached_chars'],
    apply: applyV12NormalizeDisplayRows,
  },
];

// Bumping requires writing a step or the walker silently no-ops.
export const CURRENT_MODULE_SCHEMA_VERSION: number =
  MODULE_MIGRATIONS.length > 0
    ? Math.max(...MODULE_MIGRATIONS.map((m) => m.version))
    : 4;

export async function migrateModuleIfNeeded(
  env: ModuleEnvelope,
  deps: ModuleMigrationDeps,
): Promise<ModuleMigrationResult> {
  const stored = env.translator_schema_version ?? 1;
  const target = CURRENT_MODULE_SCHEMA_VERSION;
  if (stored >= target) return { kind: 'noop', storedVersion: stored };

  const pending = MODULE_MIGRATIONS.filter(
    (m) => m.version > stored && m.version <= target,
  );

  let current = env;
  const stepsApplied: { version: number; notes: readonly string[] }[] = [];
  const t0 = Date.now();

  for (const step of pending) {
    try {
      const result = await step.apply({ env: current }, deps);
      const stamped: ModuleEnvelope = {
        ...result.nextEnv,
        translator_schema_version: step.version,
      };
      await deps.writeEnvelope(stamped);
      current = stamped;
      stepsApplied.push({ version: step.version, notes: result.notes });
      deps.log.info(
        `migrate-module(${env.id}): step v${step.version} done , ${result.notes.join(', ')}`,
      );
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      deps.log.error(
        `migrate-module(${env.id}): step v${step.version} FAILED: ${errStr}`,
      );
      return {
        kind: 'failed',
        moduleId: env.id,
        from: stored,
        to: target,
        error: errStr,
        partialAt: stepsApplied.length > 0
          ? stepsApplied[stepsApplied.length - 1]!.version
          : stored,
      };
    }
  }

  if (stepsApplied.length === 0 && stored < target) {
    const stamped: ModuleEnvelope = { ...current, translator_schema_version: target };
    await deps.writeEnvelope(stamped);
  }

  deps.log.info(
    `migrate-module(${env.id}): v${stored}->v${target} done ` +
      `steps=[${stepsApplied.map((s) => `v${s.version}`).join(',')}] ` +
      `elapsed=${Date.now() - t0}ms`,
  );
  return { kind: 'migrated', moduleId: env.id, from: stored, to: target, stepsApplied };
}
