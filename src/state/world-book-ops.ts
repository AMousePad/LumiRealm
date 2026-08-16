declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ModuleEnvelope } from './modules-store.js';
import type { BackendToFrontend } from '../types/messages.js';
import {
  hasUserEditedAnyEntry,
  mapLoreBook,
} from '../core/mappers/lorebook.js';
import { loreBookSchema, type LoreBook } from '../core/schemas/lorebook.js';
import { projectModuleRegexEntries } from './module-artifact-project.js';
import { expectCharacterEdit } from './own-character-edit.js';
import { ensureRegexOwnership } from './regex-ownership.js';

export interface ModuleArtifactInstallOptions {
  readonly requestId?: string;
  readonly stableIdPrefix?: string;
  readonly legacyScriptIdsBySourceRow?: ReadonlyMap<number, string>;
}

function cryptoUuidLocal(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `mod-rx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeScriptId(raw: string): string {
  return raw.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export function projectModuleLorebookForCreate(
  rawLorebook: readonly unknown[],
  moduleId: string,
  worldBookId: string,
): readonly Record<string, unknown>[] {
  const valid: LoreBook[] = [];
  for (const raw of rawLorebook) {
    const parsed = loreBookSchema.safeParse(raw);
    if (!parsed.success) continue;
    const lb = parsed.data;
    if (lb.key.length === 0 && lb.content.length === 0) continue;
    valid.push(lb);
  }
  const entries = mapLoreBook(valid, { worldBookId });
  return entries.map((e) => ({
    ...e,
    extensions: { ...(e.extensions ?? {}), _risu_module_id: moduleId },
  }));
}

export interface WorldBookOpsDeps {
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface WorldBookOps {
  readonly archiveWorldBookIfEdited: (
    sourceWbId: string,
    archiveName: string,
    userId: string,
    context: string,
  ) => Promise<string | null>;
  readonly archiveModuleWorldBookBeforeMigration: (
    env: ModuleEnvelope,
    userId: string,
  ) => Promise<string | null>;
  readonly syncModuleWorldBook: (
    env: ModuleEnvelope,
    userId: string,
  ) => Promise<string | null>;
  readonly deleteModuleWorldBookEverywhere: (
    moduleId: string,
    worldBookId: string,
    userId: string,
  ) => Promise<void>;
  readonly addWorldBookToCharacter: (
    characterId: string,
    worldBookId: string,
    userId: string,
  ) => Promise<void>;
  readonly removeWorldBookFromCharacter: (
    characterId: string,
    worldBookId: string,
    userId: string,
  ) => Promise<void>;
  readonly dispatchModuleArtifactInstall: (
    characterId: string,
    env: ModuleEnvelope,
    userId: string | undefined,
    options?: ModuleArtifactInstallOptions,
  ) => Promise<void>;
  readonly dispatchGlobalModuleArtifactInstall: (
    env: ModuleEnvelope,
    userId: string | undefined,
    options?: ModuleArtifactInstallOptions,
  ) => Promise<{ worldBookId: string | null }>;
  readonly dispatchGlobalModuleArtifactUninstall: (
    moduleId: string,
    artifacts: { regexScriptIds: readonly string[]; worldBookId: string | null },
    userId: string | undefined,
  ) => Promise<void>;
}

export function createWorldBookOps(deps: WorldBookOpsDeps): WorldBookOps {
  const { charactersAttachedTo, send, log, errMsg } = deps;

  async function archiveWorldBookIfEdited(
    sourceWbId: string,
    archiveName: string,
    userId: string,
    context: string,
  ): Promise<string | null> {
    const allEntries: unknown[] = [];
    let offset = 0;
    while (true) {
      const page = await spindle.world_books.entries.list(sourceWbId, { limit: 200, offset, userId });
      if (page.data.length === 0) break;
      allEntries.push(...page.data);
      if (page.data.length < 200) break;
      offset += 200;
    }
    if (allEntries.length === 0) return null;
    if (!hasUserEditedAnyEntry(allEntries)) {
      log.info(`archive(${context}): skip,no user edits detected across ${allEntries.length} entries`);
      return null;
    }
    const archive = await spindle.world_books.create({ name: archiveName }, userId);
    let copied = 0;
    for (const e of allEntries) {
      const { id: _id, world_book_id: _wbId, ...rest } = e as Record<string, unknown>;
      void _id;
      void _wbId;
      try {
        await spindle.world_books.entries.create(archive.id, rest as never, userId);
        copied++;
      } catch (err) {
        log.warn(`archive(${context}): copy entry failed: ${errMsg(err)}`);
      }
    }
    log.info(
      `archive(${context}): archived=${copied}/${allEntries.length} ` +
        `wb=${archive.id} name="${archive.name}"`,
    );
    return archive.id;
  }

  async function archiveModuleWorldBookBeforeMigration(
    env: ModuleEnvelope,
    userId: string,
  ): Promise<string | null> {
    const wbId = env.installed_world_book_id;
    if (!wbId) return null;
    const m = env.module as { name?: unknown };
    const moduleName = typeof m.name === 'string' && m.name.length > 0 ? m.name : env.id;
    const stamp = new Date().toISOString().slice(0, 10);
    return archiveWorldBookIfEdited(
      wbId,
      `[LumiRealm Backup ${stamp}] Module: ${moduleName}`,
      userId,
      `module=${env.id}`,
    );
  }

  async function deleteModuleWorldBookEverywhere(
    moduleId: string,
    worldBookId: string,
    userId: string,
  ): Promise<void> {
    const attached = await charactersAttachedTo(moduleId, userId);
    for (const charId of attached) {
      await removeWorldBookFromCharacter(charId, worldBookId, userId);
    }
    try {
      await spindle.world_books.delete(worldBookId, userId);
    } catch (err) {
      log.warn(`deleteModuleWorldBookEverywhere: delete wb=${worldBookId} failed: ${errMsg(err)}`);
    }
  }

  async function syncModuleWorldBook(
    env: ModuleEnvelope,
    userId: string,
  ): Promise<string | null> {
    const m = env.module as { name?: unknown; lorebook?: readonly unknown[] };
    const lorebook = Array.isArray(m.lorebook) ? m.lorebook : [];
    const existingId = env.installed_world_book_id;
    if (lorebook.length === 0) {
      if (existingId) {
        await deleteModuleWorldBookEverywhere(env.id, existingId, userId);
      }
      return null;
    }
    const moduleName = typeof m.name === 'string' && m.name.length > 0 ? m.name : env.id;
    if (existingId) {
      try {
        const oldIds: string[] = [];
        let offset = 0;
        while (true) {
          const page = await spindle.world_books.entries.list(existingId, { limit: 200, offset, userId });
          if (page.data.length === 0) break;
          for (const e of page.data) oldIds.push(e.id);
          if (page.data.length < 200) break;
          offset += page.data.length;
        }
        const projected = projectModuleLorebookForCreate(lorebook, env.id, existingId);
        for (const entry of projected) {
          await spindle.world_books.entries.create(existingId, entry as never, userId);
        }
        for (const id of oldIds) {
          await spindle.world_books.entries.delete(id, userId).catch(() => undefined);
        }
        await spindle.world_books.update(existingId, { name: `Module: ${moduleName}` }, userId).catch(() => undefined);
        log.info(`syncModuleWorldBook: refreshed module=${env.id} wb=${existingId} entries=${projected.length}/${lorebook.length}`);
        return existingId;
      } catch (err) {
        log.warn(`syncModuleWorldBook: refresh failed module=${env.id} wb=${existingId}: ${errMsg(err)} — kept existing WB, entries intact`);
        return existingId;
      }
    }
    const wb = await spindle.world_books.create({ name: `Module: ${moduleName}` }, userId);
    const projected = projectModuleLorebookForCreate(lorebook, env.id, wb.id);
    for (const entry of projected) {
      await spindle.world_books.entries.create(wb.id, entry as never, userId);
    }
    log.info(`syncModuleWorldBook: created module=${env.id} wb=${wb.id} entries=${projected.length}/${lorebook.length}`);
    return wb.id;
  }

  async function addWorldBookToCharacter(
    characterId: string,
    worldBookId: string,
    userId: string,
  ): Promise<void> {
    const c = await spindle.characters.get(characterId, userId);
    if (!c) return;
    const ids = (c.world_book_ids ?? []).filter((x): x is string => typeof x === 'string');
    if (ids.includes(worldBookId)) return;
    expectCharacterEdit(characterId);
    await spindle.characters.update(
      characterId,
      { world_book_ids: [...ids, worldBookId] } as never,
      userId,
    );
  }

  async function removeWorldBookFromCharacter(
    characterId: string,
    worldBookId: string,
    userId: string,
  ): Promise<void> {
    const c = await spindle.characters.get(characterId, userId);
    if (!c) return;
    const ids = (c.world_book_ids ?? []).filter((x): x is string => typeof x === 'string');
    if (!ids.includes(worldBookId)) return;
    expectCharacterEdit(characterId);
    await spindle.characters.update(
      characterId,
      { world_book_ids: ids.filter((id) => id !== worldBookId) } as never,
      userId,
    );
  }

  async function dispatchModuleArtifactInstall(
    characterId: string,
    env: ModuleEnvelope,
    userId: string | undefined,
    options?: ModuleArtifactInstallOptions,
  ): Promise<void> {
    const m = env.module as {
      name?: unknown;
      regex?: readonly unknown[];
    };
    const moduleName = typeof m.name === 'string' && m.name.length > 0
      ? m.name
      : env.id;
    let stableIndex = 0;
    const regexScripts = projectModuleRegexEntries(
      env.id,
      moduleName,
      characterId,
      m.regex,
      () => options?.stableIdPrefix
        ? `${options.stableIdPrefix}_${stableIndex++}`
        : cryptoUuidLocal(),
    ).map((script) => {
      const sourceRow = (script.metadata?._risu as { source_row_index?: unknown } | undefined)
        ?.source_row_index;
      const legacyId = typeof sourceRow === 'number'
        ? options?.legacyScriptIdsBySourceRow?.get(sourceRow)
        : undefined;
      return legacyId
        ? { ...script, metadata: { ...script.metadata, imported_script_id: normalizeScriptId(legacyId) } }
        : script;
    });
    const lorebookEntries: never[] = [];
    const ownership = userId === undefined
      ? { allOwned: false, scripts: regexScripts }
      : await ensureRegexOwnership(spindle.regex_scripts, regexScripts, userId);
    log.info(
      `dispatchModuleArtifactInstall: module=${env.id} char=${characterId} ` +
        `lorebookEntries=${lorebookEntries.length} regexScripts=${regexScripts.length}`,
    );
    send({
      type: 'install_module_artifacts',
      characterId,
      moduleId: env.id,
      worldBookName: `Module: ${moduleName}`,
      lorebookEntries,
      regexScripts: ownership.scripts,
      cleanupStale: ownership.allOwned,
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    }, userId);
  }

  // Global counterpart: one regex row set at global scope instead of N
  // per-character copies, and the module's world book joins the user's global
  // list rather than being linked to each character.
  async function dispatchGlobalModuleArtifactInstall(
    env: ModuleEnvelope,
    userId: string | undefined,
    options?: ModuleArtifactInstallOptions,
  ): Promise<{ worldBookId: string | null }> {
    const m = env.module as { name?: unknown; regex?: readonly unknown[] };
    const moduleName = typeof m.name === 'string' && m.name.length > 0 ? m.name : env.id;

    let addedWorldBookId: string | null = null;
    const wbId = env.installed_world_book_id ?? null;
    if (wbId) {
      try {
        const current = await spindle.world_books.getGlobal(userId);
        if (!current.includes(wbId)) {
          await spindle.world_books.setGlobal([...current, wbId], userId);
          // Only recorded when WE added it, so teardown can't strip a book the
          // user had already marked global.
          addedWorldBookId = wbId;
        }
        log.info(
          `dispatchGlobalModuleArtifactInstall: module=${env.id} worldBook=${wbId} ` +
            `${addedWorldBookId ? 'added to' : 'already in'} global list`,
        );
      } catch (err) {
        log.warn(`dispatchGlobalModuleArtifactInstall: setGlobal failed module=${env.id}: ${errMsg(err)}`);
      }
    }

    let stableIndex = 0;
    const regexScripts = projectModuleRegexEntries(
      env.id,
      moduleName,
      null,
      m.regex,
      () => options?.stableIdPrefix
        ? `${options.stableIdPrefix}_${stableIndex++}`
        : cryptoUuidLocal(),
    ).map((script) => {
      const sourceRow = (script.metadata?._risu as { source_row_index?: unknown } | undefined)
        ?.source_row_index;
      const legacyId = typeof sourceRow === 'number'
        ? options?.legacyScriptIdsBySourceRow?.get(sourceRow)
        : undefined;
      return legacyId
        ? { ...script, metadata: { ...script.metadata, imported_script_id: normalizeScriptId(legacyId) } }
        : script;
    });
    const ownership = userId === undefined
      ? { allOwned: false, scripts: regexScripts }
      : await ensureRegexOwnership(spindle.regex_scripts, regexScripts, userId);
    log.info(
      `dispatchGlobalModuleArtifactInstall: module=${env.id} regexScripts=${regexScripts.length} (global scope)`,
    );
    send({
      type: 'install_module_artifacts',
      characterId: null,
      moduleId: env.id,
      worldBookName: `Module: ${moduleName}`,
      lorebookEntries: [],
      regexScripts: ownership.scripts,
      cleanupStale: ownership.allOwned,
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    }, userId);
    return { worldBookId: addedWorldBookId };
  }

  async function dispatchGlobalModuleArtifactUninstall(
    moduleId: string,
    artifacts: { regexScriptIds: readonly string[]; worldBookId: string | null },
    userId: string | undefined,
  ): Promise<void> {
    if (artifacts.worldBookId) {
      try {
        const current = await spindle.world_books.getGlobal(userId);
        if (current.includes(artifacts.worldBookId)) {
          await spindle.world_books.setGlobal(
            current.filter((id) => id !== artifacts.worldBookId),
            userId,
          );
        }
      } catch (err) {
        log.warn(`dispatchGlobalModuleArtifactUninstall: setGlobal failed module=${moduleId}: ${errMsg(err)}`);
      }
    }
    log.info(
      `dispatchGlobalModuleArtifactUninstall: module=${moduleId} ` +
        `regex=${artifacts.regexScriptIds.length} worldBook=${artifacts.worldBookId ?? 'none'}`,
    );
    if (artifacts.regexScriptIds.length > 0) {
      send({
        type: 'uninstall_module_artifacts',
        characterId: null,
        moduleId,
        // Book removal is handled above via setGlobal; the shared book itself
        // stays alive for any character that attached the module normally.
        worldBookId: null,
        regexScriptIds: artifacts.regexScriptIds,
      }, userId);
    }
  }

  return {
    archiveWorldBookIfEdited,
    archiveModuleWorldBookBeforeMigration,
    syncModuleWorldBook,
    deleteModuleWorldBookEverywhere,
    addWorldBookToCharacter,
    removeWorldBookFromCharacter,
    dispatchModuleArtifactInstall,
    dispatchGlobalModuleArtifactInstall,
    dispatchGlobalModuleArtifactUninstall,
  };
}
