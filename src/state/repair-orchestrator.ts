import type {
  RepairApplyOptions,
  RepairApplyResult,
  BackendToFrontend,
} from '../types/messages.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';
import type { MigrationResult } from '../migrations/character.js';

type OperationPhase = 'started' | 'progress' | 'done' | 'error';

export interface ForceRetranslateResult {
  readonly retranslated: number;
  readonly skippedLegacy: number;
  readonly modulesReattached: number;
  readonly modulesScrubbed: number;
}

export interface ForceRetranslateOpts {
  readonly onProgress?: (processed: number, total: number, currentName: string) => void;
}

export interface RepairOrchestratorDeps {
  readonly listLumirealmCharacters: (
    userId: string,
  ) => Promise<readonly { character: { id: string; name?: string }; data: LumirealmCharacterData | null }[]>;
  readonly writeLumirealm: (characterId: string, data: LumirealmCharacterData, userId: string) => Promise<unknown>;
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<{ data: LumirealmCharacterData | null } | null>;
  readonly updateLumirealm: (
    characterId: string,
    userId: string,
    fn: (cur: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly mergeUserOverrides: (
    base: LumirealmCharacterData['user_overrides'],
    patch: Record<string, unknown>,
  ) => LumirealmCharacterData['user_overrides'];
  readonly buildDetachModulesPatch: (
    base: LumirealmCharacterData['user_overrides'],
    moduleIds: readonly string[],
  ) => Record<string, unknown>;
  readonly runCharacterMigration: (
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
    opts?: { firePromptOnNeedsReimport?: boolean; silent?: boolean },
  ) => Promise<MigrationResult['kind']>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly refreshAttachedModule: (
    characterId: string,
    env: ModuleEnvelope,
    userId: string,
  ) => Promise<void>;
  readonly translatorMigrationChecked: Set<string>;
  readonly listStaleModuleRegexIds: (userId: string) => Promise<readonly string[]>;
  readonly listStaleCharRegexIds: (userId: string) => Promise<readonly string[]>;
  readonly deleteRegexRows: (userId: string, ids: readonly string[]) => Promise<number>;
  readonly clearDeadJournals: (userId: string) => Promise<number>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly emitOperationProgress: (
    userId: string,
    operationId: string,
    phase: OperationPhase,
    title: string,
    message: string,
    fraction: number | null,
    error?: string,
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface RepairOrchestrator {
  readonly forceRetranslateAll: (
    userId: string,
    opts?: ForceRetranslateOpts,
  ) => Promise<ForceRetranslateResult>;
  readonly scrubDanglingModuleRefs: (
    characterId: string,
    danglingIds: readonly string[],
    userId: string,
  ) => Promise<void>;
  readonly applyRepair: (userId: string, options: RepairApplyOptions) => Promise<RepairApplyResult>;
}

export function createRepairOrchestrator(deps: RepairOrchestratorDeps): RepairOrchestrator {
  const {
    listLumirealmCharacters,
    writeLumirealm,
    readLumirealm,
    updateLumirealm,
    mergeUserOverrides,
    buildDetachModulesPatch,
    runCharacterMigration,
    readModuleEnvelope,
    refreshAttachedModule,
    translatorMigrationChecked,
    listStaleModuleRegexIds,
    listStaleCharRegexIds,
    deleteRegexRows,
    clearDeadJournals,
    send,
    emitOperationProgress,
    log,
    errMsg,
  } = deps;

  async function scrubDanglingModuleRefs(
    characterId: string,
    danglingIds: readonly string[],
    userId: string,
  ): Promise<void> {
    if (danglingIds.length === 0) return;
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched?.data) return;
    const oldWb = fetched.data.user_overrides.attached_module_world_books ?? {};
    const oldRx = fetched.data.user_overrides.attached_module_regex_script_ids ?? {};
    const perModuleRx: Array<{ moduleId: string; wbId: string | null; regexIds: readonly string[] }> = [];
    for (const moduleId of danglingIds) {
      const wbId = typeof oldWb[moduleId] === 'string' ? oldWb[moduleId] : null;
      const regexIds = Array.isArray(oldRx[moduleId]) ? oldRx[moduleId] : [];
      perModuleRx.push({ moduleId, wbId, regexIds });
    }
    await updateLumirealm(characterId, userId, (cur) => ({
      ...cur,
      user_overrides: mergeUserOverrides(
        cur.user_overrides,
        buildDetachModulesPatch(cur.user_overrides, danglingIds),
      ),
    }));
    for (const m of perModuleRx) {
      if (!m.wbId && m.regexIds.length === 0) continue;
      send({
        type: 'uninstall_module_artifacts',
        characterId,
        moduleId: m.moduleId,
        worldBookId: m.wbId,
        regexScriptIds: m.regexIds,
      }, userId);
    }
    log.info(`scrubDanglingModuleRefs: char=${characterId} scrubbed=${danglingIds.length}`);
  }

  async function forceRetranslateAll(
    userId: string,
    opts: ForceRetranslateOpts = {},
  ): Promise<ForceRetranslateResult> {
    let entries: Awaited<ReturnType<typeof listLumirealmCharacters>>;
    try {
      entries = await listLumirealmCharacters(userId);
    } catch (err) {
      log.warn(`forceRetranslateAll: listLumirealmCharacters failed: ${errMsg(err)}`);
      return { retranslated: 0, skippedLegacy: 0, modulesReattached: 0, modulesScrubbed: 0 };
    }
    let retranslated = 0;
    let skippedLegacy = 0;
    let modulesReattached = 0;
    let modulesScrubbed = 0;
    let processed = 0;
    const total = entries.length;
    for (const entry of entries) {
      if (!entry.data) {
        processed++;
        continue;
      }
      const charId = entry.character.id;
      const charName = entry.character.name ?? '(unnamed)';
      opts.onProgress?.(processed, total, charName);
      // Pre-0.3 cards lack envelope.source: re-translation is impossible, resetting their version would brick at v0 forever.
      if (entry.data.source === undefined) {
        skippedLegacy++;
        processed++;
        continue;
      }
      translatorMigrationChecked.delete(charId);
      const reset: typeof entry.data = { ...entry.data, translator_schema_version: 0 };
      try {
        await writeLumirealm(charId, reset, userId);
      } catch (err) {
        log.warn(`forceRetranslateAll: writeLumirealm(${charId}) failed: ${errMsg(err)}`);
        processed++;
        continue;
      }
      try {
        const kind = await runCharacterMigration(charId, charName, userId, reset, { silent: true });
        if (kind === 'migrated') retranslated++;
      } catch (err) {
        log.warn(`forceRetranslateAll: runCharacterMigration(${charId}) failed: ${errMsg(err)}`);
      }
      // Re-fetch post-migration to read the current attached_module_ids.
      let postFetch: Awaited<ReturnType<typeof readLumirealm>>;
      try {
        postFetch = await readLumirealm(charId, userId);
      } catch (err) {
        log.warn(`forceRetranslateAll: readLumirealm(${charId}) post-migrate failed: ${errMsg(err)}`);
        processed++;
        continue;
      }
      if (!postFetch?.data) {
        processed++;
        continue;
      }
      const attachedIds = postFetch.data.user_overrides.attached_module_ids ?? [];
      if (attachedIds.length === 0) {
        processed++;
        continue;
      }
      const danglingIds: string[] = [];
      for (const moduleId of attachedIds) {
        let env: ModuleEnvelope | null;
        try {
          env = await readModuleEnvelope(userId, moduleId);
        } catch (err) {
          log.warn(`forceRetranslateAll: readModuleEnvelope(${moduleId}) char=${charId} threw: ${errMsg(err)}`);
          env = null;
        }
        if (!env) {
          danglingIds.push(moduleId);
          continue;
        }
        try {
          await refreshAttachedModule(charId, env, userId);
          modulesReattached++;
        } catch (err) {
          log.warn(`forceRetranslateAll: refreshAttachedModule(${charId}, ${moduleId}) failed: ${errMsg(err)}`);
        }
      }
      if (danglingIds.length > 0) {
        try {
          await scrubDanglingModuleRefs(charId, danglingIds, userId);
          modulesScrubbed += danglingIds.length;
        } catch (err) {
          log.warn(`forceRetranslateAll: scrubDanglingModuleRefs(${charId}) failed: ${errMsg(err)}`);
        }
      }
      processed++;
    }
    return { retranslated, skippedLegacy, modulesReattached, modulesScrubbed };
  }

  async function applyRepair(
    userId: string,
    options: RepairApplyOptions,
  ): Promise<RepairApplyResult> {
    const t0 = Date.now();
    let staleCharRegexDeleted = 0;
    let staleModuleRegexDeleted = 0;
    let deadJournalsCleared = 0;
    let charactersRetranslated = 0;
    let charactersSkippedLegacy = 0;
    let modulesReattached = 0;
    let modulesScrubbed = 0;
    const opId = `repair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const opTitle = 'Repairing extension state';
    emitOperationProgress(userId, opId, 'started', opTitle, 'Sweeping stale rows…', 0);
    if (options.applyStaleCharRegex) {
      try {
        emitOperationProgress(userId, opId, 'progress', opTitle, 'Sweeping stale character regex…', 0.05);
        const ids = await listStaleCharRegexIds(userId);
        staleCharRegexDeleted = await deleteRegexRows(userId, ids);
        log.info(`applyRepair: deleted ${staleCharRegexDeleted}/${ids.length} stale char regex`);
      } catch (err) {
        log.warn(`applyRepair: stale char regex sweep failed: ${errMsg(err)}`);
      }
    }
    if (options.applyStaleModuleRegex) {
      try {
        emitOperationProgress(userId, opId, 'progress', opTitle, 'Sweeping stale module regex…', 0.15);
        const ids = await listStaleModuleRegexIds(userId);
        staleModuleRegexDeleted = await deleteRegexRows(userId, ids);
      } catch (err) {
        log.warn(`applyRepair: stale module regex sweep failed: ${errMsg(err)}`);
      }
    }
    if (options.applyDeadJournals) {
      try {
        emitOperationProgress(userId, opId, 'progress', opTitle, 'Clearing dead journals…', 0.25);
        deadJournalsCleared = await clearDeadJournals(userId);
      } catch (err) {
        log.warn(`applyRepair: dead journal clear failed: ${errMsg(err)}`);
      }
    }
    if (options.applyForceRetranslate) {
      try {
        const r = await forceRetranslateAll(userId, {
          onProgress: (processed, total, name) => {
            if (total <= 0) return;
            // Reserve 0.3 to 0.95 for retranslate progress, leaving room above and below.
            const frac = 0.3 + (processed / total) * 0.65;
            emitOperationProgress(
              userId,
              opId,
              'progress',
              opTitle,
              `Re-translating ${processed + 1}/${total}: ${name}`,
              frac,
            );
          },
        });
        charactersRetranslated = r.retranslated;
        charactersSkippedLegacy = r.skippedLegacy;
        modulesReattached = r.modulesReattached;
        modulesScrubbed = r.modulesScrubbed;
      } catch (err) {
        log.warn(`applyRepair: force retranslate failed: ${errMsg(err)}`);
      }
    }
    emitOperationProgress(userId, opId, 'done', opTitle, 'Repair complete.', 1);
    return {
      staleCharRegexDeleted,
      staleModuleRegexDeleted,
      deadJournalsCleared,
      charactersRetranslated,
      charactersSkippedLegacy,
      modulesReattached,
      modulesScrubbed,
      elapsedMs: Date.now() - t0,
    };
  }

  return { forceRetranslateAll, scrubDanglingModuleRefs, applyRepair };
}
