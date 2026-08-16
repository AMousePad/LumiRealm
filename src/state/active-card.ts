declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData, AssetIndexEntry, StoredRisuCard } from '../payload/types.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import type { AttachedModuleForRuntime } from './lumirealm-character.js';
import { resolveEffectiveModuleIds } from './modules-store.js';
import { getGlobalModuleIds } from './global-modules-cache.js';

export interface ReadLumirealmResult {
  readonly character: { readonly id: string; readonly name?: string; readonly image_id?: string | null; readonly world_book_ids?: readonly string[]; readonly extensions?: Readonly<Record<string, unknown>> };
  readonly data: LumirealmCharacterData | null;
  readonly risuai: Readonly<Record<string, unknown>>;
}

export interface ActiveCardLoaderDeps {
  readonly extensionVersion: string;
  readonly currentCharacterSchemaVersion: number;
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly worldBookIdsByCharacter: Map<string, readonly string[]>;
  readonly translatorMigrationChecked: Set<string>;
  readonly repairInFlightByUser: Set<string>;
  // Snapshot of unfulfilled REQUIRED_PERMISSIONS. Per-chat migration is
  // deferred when non-empty so we don't burn through cards with PERMISSION_DENIED.
  readonly getMissingPermissions: () => readonly string[];
  readonly readLumirealm: (characterId: string, userId: string) => Promise<ReadLumirealmResult | null>;
  readonly preValidateRequires: (req: LumirealmCharacterData['payload']['requires']) => {
    readonly ok: boolean;
    readonly missing: readonly string[];
    readonly degraded: readonly string[];
  };
  readonly buildVersionError: (missing: readonly string[]) => Error;
  readonly loadAttachedModulesForRuntime: (
    userId: string,
    attachedIds: readonly string[],
  ) => Promise<readonly AttachedModuleForRuntime[]>;
  readonly buildSyntheticStoredCard: (
    characterId: string,
    data: LumirealmCharacterData,
    risuai: Readonly<Record<string, unknown>>,
    attached: readonly AttachedModuleForRuntime[],
  ) => StoredRisuCard;
  readonly modulesByNamespaceFromCard: (card: StoredRisuCard) => Readonly<Record<string, readonly string[]>> | null;
  readonly setActiveAssetIndexes: (
    chatId: string,
    indexes: { assets: Readonly<Record<string, AssetIndexEntry>>; emotions: Readonly<Record<string, AssetIndexEntry>> },
  ) => void;
  readonly setActiveScriptstateDefaults: (
    chatId: string,
    characterId: string,
    defaults: Readonly<Record<string, string>>,
  ) => void;
  readonly setActiveModulesByNamespace: (
    chatId: string,
    characterId: string,
    map: Readonly<Record<string, readonly string[]>>,
  ) => void;
  readonly clearActiveModulesByNamespace: (chatId: string) => void;
  readonly setActiveLorebook: (
    chatId: string,
    characterId: string,
    entries: readonly import('../core/cbs/runtime/context.js').LorebookEntry[],
  ) => void;
  readonly fetchLorebookForCharacter: (
    worldBookIds: readonly string[],
    userId: string,
  ) => Promise<readonly import('../core/cbs/runtime/context.js').LorebookEntry[]>;
  readonly hasActiveLorebookForCharacter: (characterId: string) => boolean;
  readonly getActiveLorebookByCharacter: (
    characterId: string,
  ) => readonly import('../core/cbs/runtime/context.js').LorebookEntry[];
  readonly setActiveCharacterImage: (chatId: string, url: string | null) => void;
  readonly imageUrlFromId: (id: string | null | undefined) => string | null;
  readonly backfillImageJournalIfMissing: (
    characterId: string,
    avatarId: string | null,
    card: { asset_index: Readonly<Record<string, AssetIndexEntry>>; emotion_index: Readonly<Record<string, AssetIndexEntry>> },
    userId: string,
  ) => Promise<void>;
  readonly refreshPersonaImage: (userId: string) => Promise<void>;
  readonly seedAuthorsNoteFromDepthPrompt: (
    chatId: string,
    userId: string,
    characterExtensions: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  readonly runCharacterMigration: (
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
    opts?: { firePromptOnNeedsReimport?: boolean; silent?: boolean },
  ) => Promise<unknown>;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
    readonly debug: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface ActiveCardLoader {
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly maybeMigrateCharacterTranslator: (
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
  ) => void;
}

export function createActiveCardLoader(deps: ActiveCardLoaderDeps): ActiveCardLoader {
  const {
    currentCharacterSchemaVersion,
    activeCardByChat,
    worldBookIdsByCharacter,
    translatorMigrationChecked,
    repairInFlightByUser,
    getMissingPermissions,
    readLumirealm,
    preValidateRequires,
    buildVersionError,
    loadAttachedModulesForRuntime,
    buildSyntheticStoredCard,
    modulesByNamespaceFromCard,
    setActiveAssetIndexes,
    setActiveScriptstateDefaults,
    setActiveModulesByNamespace,
    clearActiveModulesByNamespace,
    setActiveLorebook,
    fetchLorebookForCharacter,
    hasActiveLorebookForCharacter,
    getActiveLorebookByCharacter,
    setActiveCharacterImage,
    imageUrlFromId,
    backfillImageJournalIfMissing,
    refreshPersonaImage,
    seedAuthorsNoteFromDepthPrompt,
    runCharacterMigration,
    toastFor,
    log,
    errMsg,
  } = deps;

  function maybeMigrateCharacterTranslator(
    characterId: string,
    characterName: string,
    userId: string,
    envelope: LumirealmCharacterData,
  ): void {
    if (translatorMigrationChecked.has(characterId)) return;
    // forceRetranslateAll resets the dedupe flag and runs migration sequentially, so a chat-open mid-loop would otherwise re-fire migration concurrently.
    if (repairInFlightByUser.has(userId)) return;
    const stored = envelope.translator_schema_version ?? 1;
    if (stored >= currentCharacterSchemaVersion) {
      translatorMigrationChecked.add(characterId);
      return;
    }
    // Defer without marking checked so the next chat-open retries once the
    // ungranted permission lands. Avoids per-card PERMISSION_DENIED storms.
    const missing = getMissingPermissions();
    if (missing.length > 0) {
      log.info(
        `maybeMigrateCharacterTranslator: defer character=${characterId},missing permissions=[${missing.join(',')}]`,
      );
      return;
    }
    translatorMigrationChecked.add(characterId);
    void runCharacterMigration(characterId, characterName, userId, envelope, {
      firePromptOnNeedsReimport: true,
    });
  }

  async function ensureActiveCardForChat(
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ): Promise<ActiveCard | null> {
    const tEnter = Date.now();
    if (userId === undefined) {
      log.info(`ensureActiveCardForChat: userId not yet captured for chatId=${chatId},will retry on next event`);
      return null;
    }
    const cached = activeCardByChat.get(chatId);
    if (cached) {
      if (cached.ownerUserId !== userId) {
        log.warn(`ensureActiveCardForChat: cache-hit owner mismatch chatId=${chatId} cachedOwner=${cached.ownerUserId} requester=${userId},refusing`);
        return null;
      }
      // Lorebook cache is keyed by character, but the chat→character index is
      // set per chat. On a warm worker the active card hits cache here without
      // the miss-path populate ever running, so {{lorebook}} would stay empty.
      // Populate once per character (Map.has guard keeps subsequent hits cheap)
      // and always (re)index this chatId.
      const hitCharId = cached.card.character_id;
      if (!hasActiveLorebookForCharacter(hitCharId)) {
        try {
          const wbIds = worldBookIdsByCharacter.get(hitCharId) ?? [];
          const lore = await fetchLorebookForCharacter(wbIds, userId);
          setActiveLorebook(chatId, hitCharId, lore);
          log.debug(`ensureActiveCardForChat: lorebook set (hit-fetch) chat=${chatId} char=${hitCharId} books=${wbIds.length} entries=${lore.length}`);
        } catch (err) {
          log.warn(`ensureActiveCardForChat: lorebook fetch (cache-hit) failed char=${hitCharId}: ${errMsg(err)}`);
          setActiveLorebook(chatId, hitCharId, []);
        }
      } else {
        const reuse = getActiveLorebookByCharacter(hitCharId);
        setActiveLorebook(chatId, hitCharId, reuse);
        log.debug(`ensureActiveCardForChat: lorebook set (hit-reuse) chat=${chatId} char=${hitCharId} entries=${reuse.length}`);
      }
      log.debug(`ensureActiveCardForChat: cache hit chatId=${chatId} characterId=${cached.card.character_id}`);
      return cached;
    }
    let tChatsGet = 0;
    if (!characterId) {
      const tChatGet0 = Date.now();
      try {
        const chat = await spindle.chats.get(chatId, userId);
        tChatsGet = Date.now() - tChatGet0;
        const resolved = chat?.character_id ?? null;
        if (resolved) {
          log.info(`ensureActiveCardForChat: resolved characterId=${resolved} via chats.get for chatId=${chatId} chats_get=${tChatsGet}ms`);
          characterId = resolved;
        }
      } catch (err) {
        tChatsGet = Date.now() - tChatGet0;
        log.warn(`ensureActiveCardForChat: chats.get(${chatId}) failed chats_get=${tChatsGet}ms: ${errMsg(err)}`);
      }
    }
    if (!characterId) {
      log.info(`ensureActiveCardForChat: no characterId for chatId=${chatId} (chat may be group/deleted),skip`);
      return null;
    }
    log.info(`ensureActiveCardForChat: cache miss chatId=${chatId} characterId=${characterId},fetching extensions`);
    const tReadLumi0 = Date.now();
    const fetched = await readLumirealm(characterId, userId);
    const tReadLumi = Date.now() - tReadLumi0;
    if (!fetched) {
      log.info(`ensureActiveCardForChat: character not found id=${characterId} (group chat or deleted)`);
      return null;
    }
    if (!fetched.data) {
      log.info(`ensureActiveCardForChat: character ${characterId} is not a lumirealm card (no extensions.lumirealm or soft-removed)`);
      return null;
    }
    const tValidate0 = Date.now();
    const check = preValidateRequires(fetched.data.payload.requires);
    const tValidate = Date.now() - tValidate0;
    if (!check.ok) {
      const err = buildVersionError(check.missing);
      log.error(err.message);
      toastFor(userId, 'error', err.message, { title: 'lumirealm' });
      return null;
    }
    if (check.degraded.length > 0) {
      log.warn(`ensureActiveCardForChat: degraded features=[${check.degraded.join(', ')}]`);
      toastFor(userId, 'warning',
        `Card uses degraded features: ${check.degraded.join(', ')}.`,
        { title: 'lumirealm' },
      );
    }
    const attachedIds = resolveEffectiveModuleIds(
      getGlobalModuleIds(userId),
      fetched.data.user_overrides.attached_module_ids,
    );
    const tModules0 = Date.now();
    const attachedForRuntime = attachedIds.length > 0
      ? await loadAttachedModulesForRuntime(userId, attachedIds)
      : [];
    const tModules = Date.now() - tModules0;
    const tBuild0 = Date.now();
    const card = buildSyntheticStoredCard(
      characterId,
      fetched.data,
      fetched.risuai,
      attachedForRuntime,
    );
    const tBuild = Date.now() - tBuild0;
    log.info(
      `ensureActiveCardForChat: loaded char=${characterId} translator=${card.risuPayload.translator_version} ` +
      `triggers=${card.risuPayload.triggers.length} lua_scripts=${card.risuPayload.lua_scripts.length} ` +
      `regex=${card.regex_scripts?.length ?? 0} assets=${Object.keys(card.asset_index).length} ` +
      `bg_html_len=${card.risuPayload.background_html?.length ?? 0} ` +
      `utility_bot=${card.risuPayload.utility_bot} ` +
      `defaults=${Object.keys(card.risuPayload.scriptstate_defaults).length} ` +
      `modules=${attachedForRuntime.length}` +
      (attachedForRuntime.length > 0
        ? ` (${attachedForRuntime.map((m) => `${m.id}:t${m.triggers.length}/a${Object.keys(m.asset_index).length}`).join(',')})`
        : '') +
      ` chats_get=${tChatsGet}ms readLumi=${tReadLumi}ms validate=${tValidate}ms modules=${tModules}ms build=${tBuild}ms`,
    );
    // Effective (globals + per-character) ids ride on the active card, so every
    // downstream reader of attached_module_ids sees globals without threading
    // userId through to reach the cache.
    const active: ActiveCard = {
      card,
      chatId,
      ownerUserId: userId,
      lumirealm: {
        ...fetched.data,
        user_overrides: {
          ...fetched.data.user_overrides,
          attached_module_ids: attachedIds,
        },
      },
    };
    activeCardByChat.set(chatId, active);
    const allWbIds = (fetched.character.world_book_ids ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const moduleWbIdSet = new Set(
      Object.values(fetched.data.user_overrides.attached_module_world_books ?? {})
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const characterOwnedWbIds = allWbIds.filter((id) => !moduleWbIdSet.has(id));
    worldBookIdsByCharacter.set(characterId, characterOwnedWbIds);
    // Risu's {{lorebook}} = characterLore + chatLore + moduleLore: feed all
    // attached books. Awaited so the cache is warm before the macroInterceptor
    // (which awaits ensureActiveCardForChat) resolves {{lorebook}}.
    try {
      const loreEntries = await fetchLorebookForCharacter(allWbIds, userId);
      setActiveLorebook(chatId, characterId, loreEntries);
      log.debug(`ensureActiveCardForChat: lorebook set (miss) chat=${chatId} char=${characterId} books=${allWbIds.length} entries=${loreEntries.length}`);
    } catch (err) {
      log.warn(`ensureActiveCardForChat: lorebook fetch failed char=${characterId}: ${errMsg(err)}`);
      setActiveLorebook(chatId, characterId, []);
    }
    // The character's OWN indexes, not `card`: the synthetic card folds attached
    // modules' asset_index in, which would journal module-owned image ids against
    // this character and make them deletion candidates when it is removed.
    void backfillImageJournalIfMissing(
      characterId,
      fetched.character.image_id ?? null,
      { asset_index: fetched.data.asset_index, emotion_index: fetched.data.emotion_index },
      userId,
    );
    setActiveAssetIndexes(chatId, {
      assets: card.asset_index,
      emotions: card.emotion_index,
    });
    setActiveScriptstateDefaults(
      chatId,
      card.character_id,
      card.risuPayload.scriptstate_defaults ?? {},
    );
    const mbnForActive = modulesByNamespaceFromCard(card);
    if (mbnForActive) setActiveModulesByNamespace(chatId, card.character_id, mbnForActive);
    else clearActiveModulesByNamespace(chatId);
    setActiveCharacterImage(
      chatId,
      imageUrlFromId(fetched.character.image_id ?? null),
    );
    void refreshPersonaImage(userId);
    // One-time seed of authors_note from CCSv3 depth_prompt on first chat-open.
    void seedAuthorsNoteFromDepthPrompt(chatId, userId, fetched.character.extensions ?? {});
    void maybeMigrateCharacterTranslator(characterId, fetched.character.name ?? '', userId, fetched.data);
    log.info(
      `ensureActiveCardForChat: DONE chatId=${chatId} characterId=${characterId} total=${Date.now() - tEnter}ms`,
    );
    return active;
  }

  return { ensureActiveCardForChat, maybeMigrateCharacterTranslator };
}
