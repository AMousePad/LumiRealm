declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope, ModuleIndexEntry, UserStorageLike as ModuleStorageLike } from '../state/modules-store.js';
import type { ModalConfirmOptions } from '../adapters/spindle-extras.js';
import {
  readMigrationState,
  writeMigrationState,
} from '../state/migration-state.js';

type OperationPhase = 'started' | 'progress' | 'done' | 'error';

interface PendingArchiveNotification {
  readonly subjectLabel: string;
  readonly archiveWbId: string;
}

const ARCHIVE_BATCH_DELAY_MS = 2000;
const MAX_ARCHIVE_LIST = 10;

export interface MassMigrationsDeps {
  readonly currentCharacterSchemaVersion: number;
  readonly currentModuleSchemaVersion: number;
  readonly translatorMigrationChecked: Set<string>;
  // Snapshot of unfulfilled REQUIRED_PERMISSIONS. Mass migration is skipped
  // entirely when non-empty so partial-permission states never mass-fail rows.
  readonly getMissingPermissions: () => readonly string[];
  readonly moduleStorage: () => ModuleStorageLike;
  readonly listModules: (userId: string) => Promise<readonly ModuleIndexEntry[]>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly listLumirealmCharacters: (userId: string) => Promise<readonly {
    readonly character: { readonly id: string; readonly name: string | null };
    readonly data: LumirealmCharacterData;
  }[]>;
  readonly writeLumirealm: (
    userId: string,
    characterId: string,
    data: LumirealmCharacterData,
  ) => Promise<void>;
  readonly runModuleMigration: (moduleId: string, userId: string) => Promise<{ ok: boolean }>;
  readonly runCharacterMigration: (
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
  ) => Promise<unknown>;
  readonly emitOperationProgress: (
    userId: string,
    operationId: string,
    phase: OperationPhase,
    title: string,
    message: string,
    fraction: number | null,
    error?: string,
  ) => void;
  readonly queueModalConfirm: (
    userId: string,
    options: Omit<ModalConfirmOptions, 'userId'>,
  ) => Promise<{ confirmed: boolean } | null>;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface MassMigrationsRunner {
  readonly runMassModuleMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runMassCharacterMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly notifyLorebookMigrationArchive: (
    subjectLabel: string,
    archiveWbId: string,
    userId: string,
  ) => void;
  readonly flushLorebookMigrationArchives: (userId: string) => Promise<void>;
}

export function createMassMigrationsRunner(deps: MassMigrationsDeps): MassMigrationsRunner {
  const {
    currentCharacterSchemaVersion,
    currentModuleSchemaVersion,
    translatorMigrationChecked,
    getMissingPermissions,
    moduleStorage,
    listModules,
    readModuleEnvelope,
    listLumirealmCharacters,
    writeLumirealm,
    runModuleMigration,
    runCharacterMigration,
    emitOperationProgress,
    queueModalConfirm,
    toastFor,
    log,
    errMsg,
  } = deps;

  function blockingPermissionsMissing(label: string): boolean {
    const missing = getMissingPermissions();
    if (missing.length === 0) return false;
    log.info(
      `mass-migration(${label}): skip, missing permissions=[${missing.join(',')}] ` +
        `(will retry on grant or next boot)`,
    );
    return true;
  }

  const massModuleMigrationStartedThisBoot = new Set<string>();
  const massCharacterMigrationStartedThisBoot = new Set<string>();

  const pendingArchivesByUser = new Map<string, PendingArchiveNotification[]>();
  const archiveFlushTimerByUser = new Map<string, ReturnType<typeof setTimeout>>();

  async function flushLorebookMigrationArchives(userId: string): Promise<void> {
    const pending = pendingArchivesByUser.get(userId);
    if (!pending || pending.length === 0) return;
    pendingArchivesByUser.delete(userId);
    const items: { subjectLabel: string; archiveName: string | null }[] = [];
    for (const p of pending) {
      let archiveName: string | null = null;
      try {
        const wb = await spindle.world_books.get(p.archiveWbId, userId);
        archiveName = (wb as { name?: string })?.name ?? null;
      } catch (err) {
        log.warn(`flushLorebookMigrationArchives: world_books.get(${p.archiveWbId}) failed: ${errMsg(err)}`);
      }
      items.push({ subjectLabel: p.subjectLabel, archiveName });
    }
    const count = items.length;
    const listed = items.slice(0, MAX_ARCHIVE_LIST);
    const overflow = count - listed.length;
    const bullets = listed
      .map((i) => i.archiveName ? `• ${i.archiveName}` : `• ${i.subjectLabel} (backup)`)
      .join('\n');
    const overflowSuffix = overflow > 0 ? `\n…and ${overflow} more` : '';
    const title = count === 1 ? 'Lorebook updated' : `${count} lorebooks updated`;
    const message =
      `${count} lorebook${count === 1 ? ' was' : 's were'} updated to apply the latest LumiRealm fixes. ` +
      `Your manual edits were saved as separate backup lorebooks in the Lorebook tab:\n\n` +
      `${bullets}${overflowSuffix}\n\n` +
      `Copy any edits from these backups into the updated lorebooks if you want to keep them.`;
    const result = await queueModalConfirm(userId, {
      title,
      message,
      variant: 'info',
      confirmLabel: 'Got it',
      cancelLabel: 'Dismiss',
    });
    if (result === null) {
      toastFor(userId, 'info', message, { title });
    }
  }

  function notifyLorebookMigrationArchive(
    subjectLabel: string,
    archiveWbId: string,
    userId: string,
  ): void {
    const list = pendingArchivesByUser.get(userId) ?? [];
    list.push({ subjectLabel, archiveWbId });
    pendingArchivesByUser.set(userId, list);
    const existing = archiveFlushTimerByUser.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      archiveFlushTimerByUser.delete(userId);
      void flushLorebookMigrationArchives(userId);
    }, ARCHIVE_BATCH_DELAY_MS);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    archiveFlushTimerByUser.set(userId, timer);
  }

  async function runMassModuleMigrationIfNeeded(userId: string): Promise<void> {
    if (massModuleMigrationStartedThisBoot.has(userId)) return;
    if (blockingPermissionsMissing('modules')) return;
    massModuleMigrationStartedThisBoot.add(userId);
    const state = await readMigrationState(spindle.userStorage, userId);
    if (state.last_swept_modules >= currentModuleSchemaVersion) {
      log.info(`mass-migration(modules): user=${userId} already swept to v${state.last_swept_modules}, skipping`);
      return;
    }
    const allModules = await listModules(userId);
    const candidates: string[] = [];
    for (const m of allModules) {
      const env = await readModuleEnvelope(userId, m.id);
      if (!env) continue;
      if ((env.translator_schema_version ?? 1) < currentModuleSchemaVersion) {
        candidates.push(m.id);
      }
    }
    if (candidates.length === 0) {
      await writeMigrationState(spindle.userStorage, userId, {
        ...state,
        last_swept_modules: currentModuleSchemaVersion,
      });
      log.info(`mass-migration(modules): user=${userId} no modules below v${currentModuleSchemaVersion}, sweep marker bumped`);
      return;
    }
    const opId = `mass-migration-modules-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const opTitle = 'Updating modules';
    emitOperationProgress(
      userId,
      opId,
      'started',
      opTitle,
      `Updating ${candidates.length} module${candidates.length === 1 ? '' : 's'}…`,
      0,
    );
    log.info(`mass-migration(modules): user=${userId} starting count=${candidates.length} opId=${opId}`);
    let processed = 0;
    let failed = 0;
    for (const moduleId of candidates) {
      try {
        const r = await runModuleMigration(moduleId, userId);
        if (!r.ok) failed++;
      } catch (err) {
        failed++;
        log.warn(`mass-migration(modules): module=${moduleId} threw: ${errMsg(err)}`);
      }
      processed++;
      emitOperationProgress(
        userId,
        opId,
        'progress',
        opTitle,
        `Updated ${processed}/${candidates.length} module${candidates.length === 1 ? '' : 's'}`,
        processed / candidates.length,
      );
    }
    if (failed === 0) {
      const after = await readMigrationState(spindle.userStorage, userId);
      await writeMigrationState(spindle.userStorage, userId, {
        ...after,
        last_swept_modules: currentModuleSchemaVersion,
      });
      log.info(`mass-migration(modules): user=${userId} done processed=${processed} opId=${opId}`);
    } else {
      log.warn(
        `mass-migration(modules): user=${userId} done with failures processed=${processed} failed=${failed} ` +
          `(sweep marker NOT bumped, will retry next boot)`,
      );
    }
    emitOperationProgress(
      userId,
      opId,
      'done',
      opTitle,
      failed === 0
        ? `Updated ${processed} module${processed === 1 ? '' : 's'}`
        : `Updated ${processed - failed}/${processed} (${failed} failed, will retry next start)`,
      1,
    );
    const existingTimer = archiveFlushTimerByUser.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      archiveFlushTimerByUser.delete(userId);
    }
    await flushLorebookMigrationArchives(userId);
    void moduleStorage;
  }

  async function runMassCharacterMigrationIfNeeded(userId: string): Promise<void> {
    if (massCharacterMigrationStartedThisBoot.has(userId)) return;
    if (blockingPermissionsMissing('characters')) return;
    massCharacterMigrationStartedThisBoot.add(userId);
    let state = await readMigrationState(spindle.userStorage, userId);
    // Self-healing every boot, not one-shot. A character imported before the
    // import-path stamp fix (or any future slip) is unowned, which silently
    // dead-zones its display, so re-stamp any unstamped character and surface
    // failures loudly rather than leaving a broken card.
    {
      const owned = await listLumirealmCharacters(userId);
      const unstamped = owned.filter((entry) => entry.data.display_owner !== true);
      const failures: string[] = [];
      let stamped = 0;
      for (const entry of unstamped) {
        try {
          await writeLumirealm(userId, entry.character.id, entry.data);
          stamped++;
        } catch (err) {
          failures.push(`${entry.character.name ?? entry.character.id}: ${errMsg(err)}`);
        }
      }
      if (unstamped.length > 0) {
        log.info(`display-owner-backfill: user=${userId} stamped=${stamped} failed=${failures.length} of ${unstamped.length} unstamped`);
      }
      if (failures.length > 0) {
        log.warn(`display-owner-backfill: stamp FAILED for ${failures.length} character(s): ${failures.join(' | ')}`);
        toastFor(userId, 'error', `${failures.length} character(s) could not claim display ownership and will render broken: ${failures.slice(0, 3).join('; ')}`, { title: 'LumiRealm display ownership failed', duration: 15000 });
      } else if (!state.display_owner_backfilled) {
        state = { ...state, display_owner_backfilled: true };
        await writeMigrationState(spindle.userStorage, userId, state);
      }
    }
    if (state.last_swept_characters >= currentCharacterSchemaVersion) {
      log.info(`mass-migration(characters): user=${userId} already swept to v${state.last_swept_characters}, skipping`);
      return;
    }
    const all = await listLumirealmCharacters(userId);
    const candidates: { id: string; name: string; data: LumirealmCharacterData }[] = [];
    for (const entry of all) {
      if ((entry.data.translator_schema_version ?? 1) < currentCharacterSchemaVersion) {
        candidates.push({ id: entry.character.id, name: entry.character.name ?? '(unnamed)', data: entry.data });
      }
    }
    if (candidates.length === 0) {
      await writeMigrationState(spindle.userStorage, userId, {
        ...state,
        last_swept_characters: currentCharacterSchemaVersion,
      });
      log.info(`mass-migration(characters): user=${userId} no characters below v${currentCharacterSchemaVersion}, sweep marker bumped`);
      return;
    }
    const opId = `mass-migration-characters-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const opTitle = 'Updating Risu cards';
    emitOperationProgress(
      userId,
      opId,
      'started',
      opTitle,
      `Updating ${candidates.length} card${candidates.length === 1 ? '' : 's'}…`,
      0,
    );
    log.info(`mass-migration(characters): user=${userId} starting count=${candidates.length} opId=${opId}`);
    let processed = 0;
    let failed = 0;
    for (const c of candidates) {
      // Per-character per-boot dedupe in translatorMigrationChecked would short-circuit if the chat opened first, so mark and run inline so both paths agree on completion ordering.
      if (translatorMigrationChecked.has(c.id)) {
        processed++;
        continue;
      }
      translatorMigrationChecked.add(c.id);
      try {
        await runCharacterMigration(c.id, c.name, userId, c.data);
      } catch (err) {
        failed++;
        translatorMigrationChecked.delete(c.id);
        log.warn(`mass-migration(characters): character=${c.id} threw: ${errMsg(err)}`);
      }
      processed++;
      emitOperationProgress(
        userId,
        opId,
        'progress',
        opTitle,
        `Updated ${processed}/${candidates.length} card${candidates.length === 1 ? '' : 's'}`,
        processed / candidates.length,
      );
    }
    if (failed === 0) {
      const after = await readMigrationState(spindle.userStorage, userId);
      await writeMigrationState(spindle.userStorage, userId, {
        ...after,
        last_swept_characters: currentCharacterSchemaVersion,
      });
      log.info(`mass-migration(characters): user=${userId} done processed=${processed} opId=${opId}`);
    } else {
      log.warn(
        `mass-migration(characters): user=${userId} done with failures processed=${processed} failed=${failed} ` +
          `(sweep marker NOT bumped, will retry next boot)`,
      );
    }
    emitOperationProgress(
      userId,
      opId,
      'done',
      opTitle,
      failed === 0
        ? `Updated ${processed} card${processed === 1 ? '' : 's'}`
        : `Updated ${processed - failed}/${processed} (${failed} failed, will retry next start)`,
      1,
    );
  }

  return {
    runMassModuleMigrationIfNeeded,
    runMassCharacterMigrationIfNeeded,
    notifyLorebookMigrationArchive,
    flushLorebookMigrationArchives,
  };
}
