declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope, ModuleIndexEntry, UserStorageLike as ModuleStorageLike } from '../state/modules-store.js';
import type { ModalConfirmOptions } from '../adapters/spindle-extras.js';
import {
  readMigrationState,
  writeMigrationState,
} from '../state/migration-state.js';
import { unrewriteText } from '../core/cbs/rewrite/unrewrite.js';
import { loadCatalog } from '../payload/import.js';

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
  readonly runMacroUnprefixSweepIfNeeded: (userId: string) => Promise<void>;
  readonly runVarScopeMigrationIfNeeded: (userId: string) => Promise<void>;
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

  const macroSweepStartedThisBoot = new Set<string>();

  // One-time sweep that un-prefixes legacy risu_* macros to raw Risu CBS across
  // every stored string surface. The evaluator resolves both forms, so this is
  // cosmetic-correctness, not load-bearing, but it normalizes storage.
  async function runMacroUnprefixSweepIfNeeded(userId: string): Promise<void> {
    if (macroSweepStartedThisBoot.has(userId)) return;
    if (blockingPermissionsMissing('macro-unprefix')) return;
    macroSweepStartedThisBoot.add(userId);
    const state = await readMigrationState(spindle.userStorage, userId);
    if (state.macros_unprefixed) return;
    const leafNames = new Set(loadCatalog().incompatibleNames());
    const un = (s: string): string => unrewriteText(s, { leafNames });
    const chars = await listLumirealmCharacters(userId);
    if (chars.length === 0) {
      await writeMigrationState(spindle.userStorage, userId, { ...state, macros_unprefixed: true });
      return;
    }
    const opId = `macro-unprefix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const opTitle = 'Updating Risu cards';
    emitOperationProgress(userId, opId, 'started', opTitle, `Updating ${chars.length} card${chars.length === 1 ? '' : 's'}…`, 0);
    log.info(`macro-unprefix: user=${userId} starting count=${chars.length} opId=${opId}`);
    let failed = 0;
    let changed = 0;
    let processed = 0;
    for (const { character, data } of chars) {
      try {
        changed += await sweepCharacterMacros(userId, character.id, data, un);
      } catch (err) {
        failed++;
        log.warn(`macro-unprefix: char=${character.id} threw: ${errMsg(err)}`);
      }
      processed++;
      emitOperationProgress(userId, opId, 'progress', opTitle, `Updated ${processed}/${chars.length} card${chars.length === 1 ? '' : 's'}`, processed / chars.length);
    }
    if (failed === 0) {
      const after = await readMigrationState(spindle.userStorage, userId);
      await writeMigrationState(spindle.userStorage, userId, { ...after, macros_unprefixed: true });
      log.info(`macro-unprefix: user=${userId} done characters=${chars.length} fields_changed=${changed}`);
    } else {
      log.warn(`macro-unprefix: user=${userId} ${failed} character(s) failed, marker NOT set (retry next boot)`);
    }
    emitOperationProgress(
      userId,
      opId,
      failed === 0 ? 'done' : 'error',
      opTitle,
      failed === 0
        ? `Updated ${chars.length} card${chars.length === 1 ? '' : 's'}`
        : `Updated ${chars.length - failed}/${chars.length} (${failed} failed, will retry next start)`,
      1,
    );
  }

  const varScopeMigrationStartedThisBoot = new Set<string>();

  async function runVarScopeMigrationIfNeeded(userId: string): Promise<void> {
    if (varScopeMigrationStartedThisBoot.has(userId)) return;
    if (blockingPermissionsMissing('var-scope')) return;
    varScopeMigrationStartedThisBoot.add(userId);
    const state = await readMigrationState(spindle.userStorage, userId);
    if (state.vars_migrated_to_chat_scope) return;
    const chars = await listLumirealmCharacters(userId);
    let migratedChats = 0;
    let failed = 0;
    const failures: string[] = [];
    for (const { character } of chars) {
      let offset = 0;
      for (;;) {
        const page = await spindle.chats.list({ characterId: character.id, limit: 100, offset, userId });
        for (const chatRow of page.data) {
          try {
            const chat = await spindle.chats.get(chatRow.id, userId);
            const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
            const mv = (meta['macro_variables'] && typeof meta['macro_variables'] === 'object'
              ? { ...(meta['macro_variables'] as Record<string, unknown>) }
              : null);
            const local = (mv && mv['local'] && typeof mv['local'] === 'object'
              ? (mv['local'] as Record<string, unknown>)
              : null);
            if (!local || Object.keys(local).length === 0) continue;
            const existingCv = (meta['chat_variables'] && typeof meta['chat_variables'] === 'object'
              ? { ...(meta['chat_variables'] as Record<string, unknown>) }
              : {}) as Record<string, unknown>;
            const mergedCv = { ...existingCv, ...local };
            const newMv = { ...mv };
            delete newMv['local'];
            await spindle.chats.update(
              chatRow.id,
              { metadata: { ...meta, chat_variables: mergedCv, macro_variables: newMv } as never },
              userId,
            );
            migratedChats += 1;
          } catch (err) {
            failed += 1;
            failures.push(`${chatRow.id}: ${errMsg(err)}`);
          }
        }
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.total) break;
      }
    }
    if (failed === 0) {
      const after = await readMigrationState(spindle.userStorage, userId);
      await writeMigrationState(spindle.userStorage, userId, { ...after, vars_migrated_to_chat_scope: true });
      log.info(`var-scope-migration: user=${userId} done migratedChats=${migratedChats}`);
    } else {
      log.warn(`var-scope-migration: user=${userId} FAILED ${failed} chat(s), marker NOT set (retry next boot): ${failures.slice(0, 3).join(' | ')}`);
      toastFor(userId, 'error', `${failed} chat(s) failed variable migration and may show reset state until restart: ${failures.slice(0, 2).join('; ')}`, { title: 'LumiRealm variable migration failed', duration: 15000 });
    }
  }

  async function sweepCharacterMacros(
    userId: string,
    characterId: string,
    data: LumirealmCharacterData,
    un: (s: string) => string,
  ): Promise<number> {
    let changed = 0;
    const char = await spindle.characters.get(characterId, userId);
    if (char) {
      const c = char as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const f of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes']) {
        const v = c[f];
        if (typeof v === 'string') { const u = un(v); if (u !== v) patch[f] = u; }
      }
      const ag = c['alternate_greetings'];
      if (Array.isArray(ag)) {
        const nag = ag.map((g) => (typeof g === 'string' ? un(g) : g));
        if (nag.some((g, i) => g !== ag[i])) patch['alternate_greetings'] = nag;
      }
      if (Object.keys(patch).length > 0) {
        await spindle.characters.update(characterId, patch as never, userId);
        changed += Object.keys(patch).length;
      }

      const wbIds = (c['world_book_ids'] as string[] | undefined) ?? [];
      for (const wbId of wbIds) {
        let offset = 0;
        for (;;) {
          const page = await spindle.world_books.entries.list(wbId, { limit: 200, offset, userId });
          for (const e of page.data) {
            const ep: Record<string, unknown> = {};
            if (typeof e.content === 'string') { const u = un(e.content); if (u !== e.content) ep['content'] = u; }
            if (typeof e.comment === 'string') { const u = un(e.comment); if (u !== e.comment) ep['comment'] = u; }
            if (Object.keys(ep).length > 0) {
              await spindle.world_books.entries.update(e.id, ep as never, userId);
              changed += Object.keys(ep).length;
            }
          }
          offset += page.data.length;
          if (page.data.length === 0 || offset >= page.total) break;
        }
      }
    }

    {
      let offset = 0;
      for (;;) {
        const page = await spindle.regex_scripts.list({ scope: 'character', scopeId: characterId, limit: 200, offset, userId });
        for (const s of page.data) {
          const rp: Record<string, unknown> = {};
          const f = un(s.find_regex); if (f !== s.find_regex) rp['find_regex'] = f;
          const r = un(s.replace_string); if (r !== s.replace_string) rp['replace_string'] = r;
          if (Object.keys(rp).length > 0) {
            await spindle.regex_scripts.update(s.id, rp as never, userId);
            changed += Object.keys(rp).length;
          }
        }
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.total) break;
      }
    }

    {
      let offset = 0;
      for (;;) {
        const page = await spindle.chats.list({ characterId, limit: 100, offset, userId });
        for (const chat of page.data) {
          const msgs = await spindle.chat.getMessages(chat.id);
          for (const m of msgs) {
            const swipes = Array.isArray(m.swipes) ? m.swipes : null;
            if (swipes && swipes.length > 0) {
              const ns = swipes.map((s) => (typeof s === 'string' ? un(s) : s));
              if (ns.some((s, i) => s !== swipes[i])) {
                await spindle.chat.updateMessage(chat.id, m.id, { swipes: ns });
                changed++;
              }
            } else if (typeof m.content === 'string') {
              const u = un(m.content);
              if (u !== m.content) {
                await spindle.chat.updateMessage(chat.id, m.id, { content: u });
                changed++;
              }
            }
          }
        }
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.total) break;
      }
    }

    const bg = data.payload.background_html;
    const bgs = data.payload.background_html_source;
    const nbg = typeof bg === 'string' ? un(bg) : bg;
    const nbgs = typeof bgs === 'string' ? un(bgs) : bgs;
    if (nbg !== bg || nbgs !== bgs) {
      await writeLumirealm(userId, characterId, {
        ...data,
        payload: {
          ...data.payload,
          background_html: nbg,
          ...(bgs !== undefined ? { background_html_source: nbgs } : {}),
        },
      });
      changed++;
    }

    return changed;
  }

  return {
    runMassModuleMigrationIfNeeded,
    runMassCharacterMigrationIfNeeded,
    runMacroUnprefixSweepIfNeeded,
    runVarScopeMigrationIfNeeded,
    notifyLorebookMigrationArchive,
    flushLorebookMigrationArchives,
  };
}
