declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData } from '../payload/types.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import type { ModuleEnvelope } from './modules-store.js';
import type { BackendToFrontend } from '../types/messages.js';
import {
  buildAttachModulePatch,
  buildDetachModulesPatch,
  mergeUserOverrides,
} from './lumirealm-character.js';
import { clearActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { clearActiveCharacterImage } from '../interpreter/image-cache.js';
import { clearActiveScriptstateDefaults } from '../interpreter/defaults-cache.js';
import { clearActiveLorebookForCharacter } from './lorebook-cache.js';

export interface CharacterModuleAttachDeps {
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<{ data: LumirealmCharacterData | null } | null>;
  readonly updateLumirealm: (
    characterId: string,
    userId: string,
    fn: (cur: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly listLumirealmCharacters: (userId: string) => Promise<readonly {
    readonly character: { readonly id: string };
    readonly data: LumirealmCharacterData;
  }[]>;
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
  ) => Promise<void>;
  readonly refreshRisuAssetMap: (characterId: string, userId: string) => Promise<void>;
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly compiledByCharacter: Map<string, unknown>;
  readonly lastSentBgHtmlByChat: Map<string, string>;
  readonly variableState: { clearChat: (chatId: string) => void };
  readonly toggleState: { clearChat: (chatId: string) => void };
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly refreshToggleDefinitions: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly refreshBgHtml: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
  ) => Promise<void>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly onActiveChatEvicted?: (chatId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface CharacterModuleAttach {
  readonly attachModuleToCharacter: (characterId: string, moduleId: string, userId: string) => Promise<{ ok: boolean; reason?: string }>;
  readonly detachModuleFromCharacter: (characterId: string, moduleId: string, userId: string) => Promise<{ ok: boolean; reason?: string }>;
  readonly refreshAttachedModule: (characterId: string, env: ModuleEnvelope, userId: string) => Promise<void>;
  readonly detachModuleFromAllCharacters: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string | undefined) => void;
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
}

export function createCharacterModuleAttach(deps: CharacterModuleAttachDeps): CharacterModuleAttach {
  const {
    readLumirealm,
    updateLumirealm,
    readModuleEnvelope,
    listLumirealmCharacters,
    addWorldBookToCharacter,
    removeWorldBookFromCharacter,
    dispatchModuleArtifactInstall,
    refreshRisuAssetMap,
    activeCardByChat,
    compiledByCharacter,
    lastSentBgHtmlByChat,
    variableState,
    toggleState,
    ensureActiveCardForChat,
    refreshToggleDefinitions,
    refreshBgHtml,
    send,
    onActiveChatEvicted,
    log,
    errMsg,
  } = deps;

  function invalidateActiveForCharacter(characterId: string, userId: string | undefined): void {
    // Evict only entries owned by the same user so user B can't wipe user A's cache. Without a userId we can't attribute, so skip.
    if (userId === undefined) {
      log.warn(`invalidateActiveForCharacter: skipped char=${characterId} (no userId)`);
      return;
    }
    let evicted = 0;
    const evictedChats: string[] = [];
    for (const [chatId, active] of activeCardByChat) {
      if (active.card.character_id === characterId && active.ownerUserId === userId) {
        activeCardByChat.delete(chatId);
        onActiveChatEvicted?.(chatId);
        clearActiveAssetIndexes(chatId);
        clearActiveCharacterImage(chatId);
        clearActiveScriptstateDefaults(chatId);
        variableState.clearChat(chatId);
        toggleState.clearChat(chatId);
        lastSentBgHtmlByChat.delete(chatId);
        evictedChats.push(chatId);
        evicted += 1;
      }
    }
    compiledByCharacter.delete(characterId);
    clearActiveLorebookForCharacter(characterId);
    log.info(`invalidateActiveForCharacter: char=${characterId} evictedChats=${evicted}`);
    for (const chatId of evictedChats) {
      void (async () => {
        const reactivated = await ensureActiveCardForChat(chatId, null, userId);
        if (reactivated) {
          await refreshToggleDefinitions(reactivated, chatId, userId, { force: true });
          await refreshBgHtml(reactivated, chatId, userId);
        }
      })();
    }
  }

  async function charactersAttachedTo(moduleId: string, userId: string): Promise<readonly string[]> {
    const entries = await listLumirealmCharacters(userId);
    const out: string[] = [];
    for (const e of entries) {
      const ids = e.data.user_overrides.attached_module_ids ?? [];
      if (ids.includes(moduleId)) out.push(e.character.id);
    }
    return out;
  }

  async function attachModuleToCharacter(
    characterId: string,
    moduleId: string,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const env = await readModuleEnvelope(userId, moduleId);
    if (!env) return { ok: false, reason: `module ${moduleId} not in library` };
    const updated = await updateLumirealm(characterId, userId, (cur) => {
      const ids = cur.user_overrides.attached_module_ids ?? [];
      if (ids.includes(moduleId)) return cur;
      return {
        ...cur,
        user_overrides: mergeUserOverrides(
          cur.user_overrides,
          buildAttachModulePatch(cur.user_overrides, moduleId, env.installed_world_book_id ?? null),
        ),
      };
    });
    if (!updated) return { ok: false, reason: 'character is not a lumirealm card' };
    if (env.installed_world_book_id) {
      await addWorldBookToCharacter(characterId, env.installed_world_book_id, userId).catch((err) => {
        log.warn(`attachModuleToCharacter: addWorldBookToCharacter failed char=${characterId} module=${moduleId}: ${errMsg(err)}`);
      });
    }
    invalidateActiveForCharacter(characterId, userId);
    await dispatchModuleArtifactInstall(characterId, env, userId);
    await refreshRisuAssetMap(characterId, userId);
    return { ok: true };
  }

  async function detachModuleFromCharacter(
    characterId: string,
    moduleId: string,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched || !fetched.data) {
      return { ok: false, reason: 'character is not a lumirealm card' };
    }
    const wbId = fetched.data.user_overrides.attached_module_world_books?.[moduleId] ?? null;
    const regexIds = fetched.data.user_overrides.attached_module_regex_script_ids?.[moduleId] ?? [];
    const updated = await updateLumirealm(characterId, userId, (cur) => {
      const ids = cur.user_overrides.attached_module_ids ?? [];
      if (!ids.includes(moduleId)) return cur;
      return {
        ...cur,
        user_overrides: mergeUserOverrides(
          cur.user_overrides,
          buildDetachModulesPatch(cur.user_overrides, [moduleId]),
        ),
      };
    });
    if (!updated) return { ok: false, reason: 'character is not a lumirealm card' };
    invalidateActiveForCharacter(characterId, userId);
    if (wbId) {
      await removeWorldBookFromCharacter(characterId, wbId, userId).catch((err) => {
        log.warn(`detachModuleFromCharacter: removeWorldBookFromCharacter failed char=${characterId}: ${errMsg(err)}`);
      });
      const env = await readModuleEnvelope(userId, moduleId);
      if (env && env.installed_world_book_id !== wbId) {
        try {
          await spindle.world_books.delete(wbId, userId);
          log.info(`detachModuleFromCharacter: deleted legacy per-char world_book wb=${wbId}`);
        } catch (err) {
          log.warn(`detachModuleFromCharacter: legacy world_book delete failed wb=${wbId}: ${errMsg(err)}`);
        }
      }
    }
    if (regexIds.length > 0) {
      send({ type: 'uninstall_module_artifacts', characterId, moduleId, worldBookId: null, regexScriptIds: regexIds }, userId);
    }
    await refreshRisuAssetMap(characterId, userId);
    return { ok: true };
  }

  // MUST NOT delete the module's world_book, it is shared across every character attached to the module so dropping it here destroys lore.
  async function refreshAttachedModule(
    characterId: string,
    env: ModuleEnvelope,
    userId: string,
  ): Promise<void> {
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched || !fetched.data) return;
    // Install and verify the replacement first. The frontend removes stale
    // rows only after every projected row is present, then reports the new ids.
    await dispatchModuleArtifactInstall(characterId, env, userId);
    invalidateActiveForCharacter(characterId, userId);
    await refreshRisuAssetMap(characterId, userId);
  }

  async function detachModuleFromAllCharacters(
    moduleId: string,
    userId: string,
  ): Promise<readonly string[]> {
    const entries = await listLumirealmCharacters(userId);
    const touched: string[] = [];
    for (const e of entries) {
      const ids = e.data.user_overrides.attached_module_ids ?? [];
      if (!ids.includes(moduleId)) continue;
      const wbId = e.data.user_overrides.attached_module_world_books?.[moduleId] ?? null;
      const regexIds = e.data.user_overrides.attached_module_regex_script_ids?.[moduleId] ?? [];
      await updateLumirealm(e.character.id, userId, (cur) => ({
        ...cur,
        user_overrides: mergeUserOverrides(
          cur.user_overrides,
          buildDetachModulesPatch(cur.user_overrides, [moduleId]),
        ),
      }));
      invalidateActiveForCharacter(e.character.id, userId);
      if (wbId) {
        await removeWorldBookFromCharacter(e.character.id, wbId, userId).catch((err) => {
          log.warn(`detachModuleFromAllCharacters: removeWorldBookFromCharacter failed char=${e.character.id}: ${errMsg(err)}`);
        });
      }
      if (regexIds.length > 0) {
        send({
          type: 'uninstall_module_artifacts',
          characterId: e.character.id,
          moduleId,
          worldBookId: null,
          regexScriptIds: regexIds,
        }, userId);
      }
      touched.push(e.character.id);
    }
    return touched;
  }

  return {
    attachModuleToCharacter,
    detachModuleFromCharacter,
    refreshAttachedModule,
    detachModuleFromAllCharacters,
    invalidateActiveForCharacter,
    charactersAttachedTo,
  };
}
