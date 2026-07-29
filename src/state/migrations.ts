declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';
import type { BackendToFrontend } from '../types/messages.js';
import {
  migrateCharacterIfNeeded,
  type MigrationDeps,
  type MigrationResult,
} from './translator-migrations.js';
import {
  migrateModuleIfNeeded,
  type ModuleMigrationDeps,
} from './module-migrations.js';
import { markLegacyReimportWarned } from './legacy-reimport-warnings.js';
import { getRegexScriptsApi } from '../adapters/spindle-extras.js';

export interface MigrationsFactoryDeps {
  readonly extensionVersion: string;
  readonly currentModuleSchemaVersion: number;
  readonly translatorMigrationChecked: Set<string>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly writeModuleEnvelope: (userId: string, env: ModuleEnvelope) => Promise<void>;
  readonly dispatchModuleArtifactInstall: (
    characterId: string,
    env: ModuleEnvelope,
    userId: string | undefined,
  ) => Promise<void>;
  readonly writeLumirealm: (
    characterId: string,
    data: LumirealmCharacterData,
    userId: string,
  ) => Promise<unknown>;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string | undefined) => void;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly archiveModuleWorldBookBeforeMigration: (
    env: ModuleEnvelope,
    userId: string,
  ) => Promise<string | null>;
  readonly syncModuleWorldBook: (env: ModuleEnvelope, userId: string) => Promise<string | null>;
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly refreshAttachedModule: (
    characterId: string,
    env: ModuleEnvelope,
    userId: string,
  ) => Promise<void>;
  readonly notifyLorebookMigrationArchive: (
    subjectLabel: string,
    archiveWbId: string,
    userId: string,
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface MigrationsRunner {
  readonly runCharacterMigration: (
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
    opts?: { firePromptOnNeedsReimport?: boolean; silent?: boolean },
  ) => Promise<MigrationResult['kind']>;
  readonly runModuleMigration: (
    moduleId: string,
    userId: string,
  ) => Promise<{ ok: boolean }>;
}

// Walk Lumi's regex_scripts pages, run transform on each row's replace_string,
// patch via regex_scripts.update only when the result differs. predicate filters
// which rows the walk acts on.
async function applyRegexReplaceStringTransform(
  predicate: (row: Record<string, unknown>) => boolean,
  userId: string,
  transform: (replace_string: string) => string,
  log: { warn: (s: string) => void },
  errMsg: (e: unknown) => string,
): Promise<{ scanned: number; updated: number; failed: number } | null> {
  const api = getRegexScriptsApi();
  if (!api?.list || !api.update) return null;
  const PAGE_SIZE = 200;
  let scanned = 0;
  let updated = 0;
  let failed = 0;
  let offset = 0;
  while (true) {
    const page = await api.list({ userId, limit: PAGE_SIZE, offset });
    if (!Array.isArray(page.data) || page.data.length === 0) break;
    for (const r of page.data) {
      const row = r as Record<string, unknown>;
      if (!predicate(row)) continue;
      scanned += 1;
      const id = typeof row['id'] === 'string' ? (row['id'] as string) : null;
      const cur = typeof row['replace_string'] === 'string'
        ? (row['replace_string'] as string)
        : '';
      if (!id) continue;
      const next = transform(cur);
      if (next === cur) continue;
      try {
        await api.update(id, { replace_string: next }, userId);
        updated += 1;
      } catch (err) {
        failed += 1;
        log.warn(`applyRegexReplaceStringTransform: update id=${id} failed: ${errMsg(err)}`);
      }
    }
    offset += page.data.length;
    if (typeof page.total === 'number' && offset >= page.total) break;
  }
  return { scanned, updated, failed };
}

// Generic multi-field row patch. Returns null when host lacks the update API.
async function applyRegexRowPatch(
  predicate: (row: Record<string, unknown>) => boolean,
  userId: string,
  patch: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  log: { warn: (s: string) => void },
  errMsg: (e: unknown) => string,
): Promise<{ scanned: number; updated: number; failed: number } | null> {
  const api = getRegexScriptsApi();
  if (!api?.list || !api.update) return null;
  const PAGE_SIZE = 200;
  let scanned = 0;
  let updated = 0;
  let failed = 0;
  let offset = 0;
  while (true) {
    const page = await api.list({ userId, limit: PAGE_SIZE, offset });
    if (!Array.isArray(page.data) || page.data.length === 0) break;
    for (const r of page.data) {
      const row = r as Record<string, unknown>;
      if (!predicate(row)) continue;
      scanned += 1;
      const id = typeof row['id'] === 'string' ? (row['id'] as string) : null;
      if (!id) continue;
      const fields = patch(row);
      if (fields === null) continue;
      try {
        await api.update(id, fields as never, userId);
        updated += 1;
      } catch (err) {
        failed += 1;
        log.warn(`applyRegexRowPatch: update id=${id} failed: ${errMsg(err)}`);
      }
    }
    offset += page.data.length;
    if (typeof page.total === 'number' && offset >= page.total) break;
  }
  return { scanned, updated, failed };
}

function isCharacterScopedRow(characterId: string, row: Record<string, unknown>): boolean {
  if (row['scope'] !== 'character') return false;
  if (row['scope_id'] !== characterId) return false;
  const meta = row['metadata'] as { _risu?: { module_id?: unknown } } | undefined;
  // Exclude module-installed rows so module rules are never touched by character migrations.
  if (typeof meta?._risu?.module_id === 'string' && meta._risu.module_id.length > 0) return false;
  return true;
}

function isModuleRowFor(moduleId: string, row: Record<string, unknown>): boolean {
  const meta = row['metadata'] as { _risu?: { module_id?: unknown } } | undefined;
  return meta?._risu?.module_id === moduleId;
}

export function createMigrationsRunner(deps: MigrationsFactoryDeps): MigrationsRunner {
  const {
    extensionVersion,
    currentModuleSchemaVersion,
    translatorMigrationChecked,
    send,
    readModuleEnvelope,
    writeModuleEnvelope,
    dispatchModuleArtifactInstall,
    writeLumirealm,
    invalidateActiveForCharacter,
    toastFor,
    archiveModuleWorldBookBeforeMigration,
    syncModuleWorldBook,
    charactersAttachedTo,
    refreshAttachedModule,
    notifyLorebookMigrationArchive,
    log,
    errMsg,
  } = deps;

  async function runCharacterMigration(
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
    opts?: { firePromptOnNeedsReimport?: boolean; silent?: boolean },
  ): Promise<MigrationResult['kind']> {
    const migrationDeps: MigrationDeps = {
      extensionVersion,
      log,
      installCharacterRegexScripts: async (charId, charName, scripts) => {
        send({
          type: 'install_regex_scripts',
          characterId: charId,
          characterName: charName,
          scripts: scripts.map((s) => ({ ...s, metadata: { ...(s.metadata ?? {}) } })),
        }, userId);
      },
      reinstallAttachedModules: async (charId) => {
        const ids = envelope.user_overrides.attached_module_ids ?? [];
        let count = 0;
        for (const moduleId of ids) {
          try {
            const env = await readModuleEnvelope(userId, moduleId);
            if (!env) continue;
            await dispatchModuleArtifactInstall(charId, env, userId);
            count++;
          } catch (err) {
            log.warn(
              `runCharacterMigration: reinstall module=${moduleId} char=${charId} threw: ${errMsg(err)}`,
            );
          }
        }
        return count;
      },
      dispatchSvgRasterize: (charId, charName, svgs) => {
        const filtered = svgs.filter((t) => t.classification !== 'templated');
        if (filtered.length === 0) return;
        log.info(
          `runCharacterMigration: dispatching rasterize_svgs char=${charId} count=${filtered.length}`,
        );
        send({
          type: 'rasterize_svgs',
          characterId: charId,
          characterName: charName,
          svgs: filtered.map((t) => ({
            markerN: t.markerN,
            svg: t.svg,
            classification: t.classification as 'simple' | 'theme-reactive' | 'animated',
            width: t.width,
            height: t.height,
          })),
        }, userId);
      },
      writeEnvelope: async (charId, data, uid) => {
        await writeLumirealm(charId, data, uid);
      },
      getAvatarImageId: async (charId, uid) => {
        try {
          const ch = await spindle.characters.get(charId, uid) as { image_id?: unknown };
          return typeof ch?.image_id === 'string' && ch.image_id.length > 0
            ? ch.image_id
            : null;
        } catch {
          return null;
        }
      },
      getCharacterWorldBookIds: async (charId, uid) => {
        try {
          const ch = await spindle.characters.get(charId, uid) as { world_book_ids?: unknown };
          if (!Array.isArray(ch?.world_book_ids)) return [];
          return ch.world_book_ids.filter((x): x is string => typeof x === 'string');
        } catch {
          return [];
        }
      },
      listWorldBookEntries: async (wbId, uid) => {
        const out: {
          id: string;
          exclude_greeting: boolean;
          extensions: Record<string, unknown> | null;
        }[] = [];
        let offset = 0;
        while (true) {
          const page = await spindle.world_books.entries.list(wbId, { limit: 200, offset, userId: uid });
          for (const e of page.data) {
            const ee = e as {
              id?: unknown;
              exclude_greeting?: unknown;
              extensions?: unknown;
            };
            const id = typeof ee.id === 'string' ? ee.id : null;
            if (id === null) continue;
            const ext = ee.extensions && typeof ee.extensions === 'object' && !Array.isArray(ee.extensions)
              ? ee.extensions as Record<string, unknown>
              : null;
            out.push({
              id,
              exclude_greeting: ee.exclude_greeting === true,
              extensions: ext,
            });
          }
          if (page.data.length < 200) break;
          offset += 200;
        }
        return out;
      },
      updateWorldBookEntryExtensions: async (entryId, extensions, uid) => {
        await spindle.world_books.entries.update(entryId, { extensions } as never, uid);
      },
      updateWorldBookEntryActivation: async (entryId, input, uid) => {
        await spindle.world_books.entries.update(entryId, input, uid);
      },
      applyCharacterRegexReplaceStringTransform: async (charId, uid, transform) => {
        return applyRegexReplaceStringTransform(
          (row) => isCharacterScopedRow(charId, row),
          uid,
          transform,
          log,
          errMsg,
        );
      },
      applyCharacterRegexRowPatch: async (charId, uid, patch) => {
        return applyRegexRowPatch(
          (row) => isCharacterScopedRow(charId, row),
          uid,
          patch,
          log,
          errMsg,
        );
      },
    };
    const result = await migrateCharacterIfNeeded(
      { characterId, characterName, userId, envelope },
      migrationDeps,
    );
    if (result.kind === 'migrated') {
      invalidateActiveForCharacter(characterId, userId);
      if (!opts?.silent) {
        toastFor(userId, 'success',
          `Updated ${characterName} for the latest LumiRealm fixes.`,
          { title: 'lumirealm' },
        );
      }
    } else if (result.kind === 'needs_reimport') {
      if (opts?.firePromptOnNeedsReimport !== true) return result.kind;
      const { alreadyWarned } = await markLegacyReimportWarned(
        spindle.userStorage,
        userId,
        characterId,
      );
      if (alreadyWarned) return result.kind;
      send({
        type: 'notify_legacy_card_needs_reimport',
        characterId,
        characterName,
      }, userId);
    } else if (result.kind === 'failed') {
      log.error(
        `migration failed char=${characterId}: ${result.error} (will retry next boot)`,
      );
      translatorMigrationChecked.delete(characterId);
    }
    return result.kind;
  }

  async function runModuleMigration(
    moduleId: string,
    userId: string,
  ): Promise<{ ok: boolean }> {
    const env = await readModuleEnvelope(userId, moduleId);
    if (!env) return { ok: true };
    const stored = env.translator_schema_version ?? 1;
    if (stored >= currentModuleSchemaVersion) return { ok: true };
    let archiveWbId: string | null = null;
    const moduleDeps: ModuleMigrationDeps = {
      syncWorldBook: async (e) => {
        archiveWbId = await archiveModuleWorldBookBeforeMigration(e, userId);
        return syncModuleWorldBook(e, userId);
      },
      reinstallArtifactsForAttached: async (mid) => {
        const charIds = await charactersAttachedTo(mid, userId);
        let count = 0;
        for (const charId of charIds) {
          try {
            await dispatchModuleArtifactInstall(charId, env, userId);
            count++;
          } catch (err) {
            log.warn(
              `runModuleMigration: reinstall char=${charId} module=${mid} threw: ${errMsg(err)}`,
            );
          }
        }
        return count;
      },
      applyModuleRegexReplaceStringTransform: async (mid, transform) => {
        return applyRegexReplaceStringTransform(
          (row) => isModuleRowFor(mid, row),
          userId,
          transform,
          log,
          errMsg,
        );
      },
      applyModuleRegexRowPatch: async (mid, patch) => {
        return applyRegexRowPatch(
          (row) => isModuleRowFor(mid, row),
          userId,
          patch,
          log,
          errMsg,
        );
      },
      listWorldBookEntries: async (worldBookId) => {
        const out: {
          id: string;
          exclude_greeting: boolean;
          extensions: Record<string, unknown> | null;
        }[] = [];
        let offset = 0;
        while (true) {
          const page = await spindle.world_books.entries.list(
            worldBookId,
            { limit: 200, offset, userId },
          );
          for (const entry of page.data) {
            const entryRecord = entry as unknown as {
              exclude_greeting?: unknown;
            };
            const extensions =
              entry.extensions &&
              typeof entry.extensions === 'object' &&
              !Array.isArray(entry.extensions)
                ? entry.extensions as Record<string, unknown>
                : null;
            out.push({
              id: entry.id,
              exclude_greeting: entryRecord.exclude_greeting === true,
              extensions,
            });
          }
          if (page.data.length < 200) break;
          offset += page.data.length;
        }
        return out;
      },
      updateWorldBookEntryActivation: async (entryId, input) => {
        await spindle.world_books.entries.update(entryId, input, userId);
      },
      refreshArtifactsForAttached: async (mid) => {
        const charIds = await charactersAttachedTo(mid, userId);
        let count = 0;
        for (const charId of charIds) {
          try {
            await refreshAttachedModule(charId, env, userId);
            count++;
          } catch (err) {
            log.warn(
              `runModuleMigration: refresh char=${charId} module=${mid} threw: ${errMsg(err)}`,
            );
          }
        }
        return count;
      },
      writeEnvelope: async (next) => {
        await writeModuleEnvelope(userId, next);
      },
      log,
    };
    const result = await migrateModuleIfNeeded(env, moduleDeps);
    if (result.kind === 'migrated') {
      const charIds = await charactersAttachedTo(moduleId, userId);
      for (const charId of charIds) invalidateActiveForCharacter(charId, userId);
      if (archiveWbId) {
        const m = env.module as { name?: unknown };
        const moduleName = typeof m.name === 'string' && m.name.length > 0 ? m.name : env.id;
        notifyLorebookMigrationArchive(`Module: ${moduleName}`, archiveWbId, userId);
      }
      return { ok: true };
    }
    if (result.kind === 'failed') return { ok: false };
    return { ok: true };
  }

  return { runCharacterMigration, runModuleMigration };
}
