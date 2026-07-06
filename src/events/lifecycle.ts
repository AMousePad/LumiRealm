import type { BackendToFrontend } from '../types/messages.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import type { RisuBinding } from '../interpreter/runtime.js';
import type { OrphanDetectDeps } from '../state/orphan-detect.js';
import type { JournalStorage, ImageJournalFile } from '../state/image-journal.js';
import { invalidateRecentFlush } from '../state/recent-flush-cache.js';

type EventHandler = (raw: unknown, userId: string | undefined) => Promise<void>;

export type OperationPhase = 'started' | 'progress' | 'done' | 'error';

export interface LifecycleEventHandlerDeps {
  // Per-user attribution + bookkeeping
  readonly captureUserId: (userId: string | undefined, where: string) => void;
  readonly extractIds: (payload: unknown) => { chatId: string | null; characterId: string | null };
  readonly dumpPayload: (raw: unknown) => string;

  // Module-state maps (passed by reference, mutated by handlers)
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly lastActiveChatByUser: Map<string, string>;
  readonly lastSentBgHtmlByChat: Map<string, string>;
  readonly compiledByCharacter: Map<string, unknown>;
  readonly worldBookIdsByCharacter: Map<string, readonly string[]>;
  readonly variableState: { clearChat: (chatId: string) => void };
  readonly toggleState: { clearChat: (chatId: string) => void };

  // Active-card / cache helpers
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string | undefined) => void;
  readonly onActiveChatEvicted?: (chatId: string) => void;
  readonly invalidateRenderMcpForChat: (chatId: string) => void;
  readonly invalidateRenderMcpForMessage: (chatId: string, messageId: string) => void;
  readonly invalidateMacroInterceptorForChat: (chatId: string) => void;
  readonly invalidateListenEditPreload: (chatId: string) => void;
  readonly refreshMessagesCache: (chatId: string, userId: string | undefined) => Promise<void>;
  readonly invalidateMessagesCache: (chatId: string) => void;
  readonly clearActiveAssetIndexes: (chatId: string) => void;
  readonly clearActiveCharacterImage: (chatId: string) => void;
  readonly clearActiveScriptstateDefaults: (chatId: string) => void;
  readonly clearActiveLorebook: (chatId: string) => void;
  readonly clearVarOverlay: (chatId: string) => void;
  readonly clearMacroVarOverlay: (chatId: string) => void;

  // Refresh / dispatch
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string | undefined) => Promise<void>;
  readonly refreshVariables: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly refreshToggleDefinitions: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly runBinding: (
    active: ActiveCard,
    chatId: string,
    binding: RisuBinding,
    userId: string | undefined,
  ) => Promise<void>;
  // Risu runVar pass: strip + persist message-text setvar (see message-var-pass.ts).
  readonly runMessageVarPass: (chatId: string, characterId: string, userId: string) => Promise<void>;
  readonly generationEndedBindings: readonly RisuBinding[];

  // Self-echo gates
  readonly consumeOwnChatChange: (chatId: string) => boolean;
  readonly consumeOwnCharacterEdit: (characterId: string) => boolean;
  readonly consumeIfOurWrite: (chatId: string, messageId: string, content: string) => boolean;

  // Drawer / FE messaging
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly sendSetActiveChat: (
    activeChatId: string | null,
    activeCharacterId: string | null,
    userId: string | undefined,
  ) => void;
  /** Best-effort call to Lumi's ctx.chat.setStyleMode. Feature-detected,
   *  no-op on hosts that predate the API. */
  readonly setChatStyleMode: (
    chatId: string,
    mode: 'bounded' | 'extension-relaxed',
    userId: string | undefined,
  ) => void;
  readonly listCards: (userId: string | undefined) => Promise<readonly import('../types/messages.js').CardSummary[]>;
  readonly pushCards: (cards: readonly import('../types/messages.js').CardSummary[], userId: string | undefined) => void;

  // CHARACTER_DELETED cleanup
  readonly deleteCardByChar: (
    characterId: string,
    userId: string | undefined,
    mode: 'soft' | 'cascade',
  ) => Promise<void>;
  readonly journalStorage: () => JournalStorage;
  readonly readImageJournalFile: (
    storage: JournalStorage,
    userId: string,
    characterId: string,
  ) => Promise<ImageJournalFile | null>;
  readonly clearImageJournal: (storage: JournalStorage, userId: string, characterId: string) => Promise<void>;
  readonly buildLiveImageIdSet: (deps: OrphanDetectDeps) => Promise<{ readonly liveIds: ReadonlySet<string> }>;
  readonly buildOrphanDetectDepsExcluding: (userId: string, excludeCharacterId: string) => OrphanDetectDeps;
  readonly deleteImageIds: (
    ids: readonly string[],
    userId: string,
    context: string,
    onProgress?: (processed: number, total: number) => void,
  ) => Promise<{ deleted: number; absent: number; failed: number }>;
  readonly emitOperationProgress: (
    userId: string,
    operationId: string,
    phase: OperationPhase,
    title: string,
    message: string,
    fraction: number | null,
    error?: string,
  ) => void;

  // Spindle wrappers
  readonly chatsGet: (chatId: string, userId: string | undefined) => Promise<{ character_id?: string } | null>;

  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface LifecycleEventHandlers {
  readonly SETTINGS_UPDATED: EventHandler;
  readonly CHAT_CHANGED: EventHandler;
  readonly MESSAGE_SENT: EventHandler;
  readonly GENERATION_STARTED: EventHandler;
  readonly GENERATION_ENDED: EventHandler;
  readonly GENERATION_STOPPED: EventHandler;
  readonly MESSAGE_SWIPED: EventHandler;
  readonly MESSAGE_EDITED: EventHandler;
  readonly MESSAGE_DELETED: EventHandler;
  readonly CHAT_DELETED: EventHandler;
  readonly CHARACTER_DELETED: EventHandler;
  readonly CHARACTER_CREATED: EventHandler;
  readonly CHARACTER_EDITED: EventHandler;
  readonly WORLD_BOOK_CHANGED: EventHandler;
  readonly WORLD_BOOK_DELETED: EventHandler;
  readonly WORLD_BOOK_ENTRY_CHANGED: EventHandler;
  readonly WORLD_BOOK_ENTRY_DELETED: EventHandler;
}

// Allow-list for paths warranting refresh on external CHAT_CHANGED, non-var writes are skipped. ADD a prefix here if a handler ever reads a new chat.metadata.X path or refresh silently breaks under burst writes.
const REFRESH_FIELD_PREFIXES = [
  'metadata.macro_variables',
  'metadata.chat_variables',
] as const;

function changedFieldsRequireRefresh(fields: Set<string> | 'unknown'): boolean {
  if (fields === 'unknown') return true;
  for (const f of fields) {
    for (const prefix of REFRESH_FIELD_PREFIXES) {
      if (f === prefix || f.startsWith(`${prefix}.`)) return true;
    }
  }
  return false;
}

interface MessageEditedPayload {
  readonly chatId?: string;
  readonly message?: {
    readonly id?: string;
    readonly chat_id?: string;
    readonly content?: string;
    readonly extra?: { readonly spindle_metadata?: { readonly edited_by?: unknown } };
    readonly metadata?: { readonly edited_by?: unknown };
  };
}

function readEditedBy(payload: MessageEditedPayload): string | null {
  const fromExtra = payload.message?.extra?.spindle_metadata?.edited_by;
  if (typeof fromExtra === 'string') return fromExtra;
  const fromMeta = payload.message?.metadata?.edited_by;
  if (typeof fromMeta === 'string') return fromMeta;
  return null;
}

const CHAT_CHANGED_DEBOUNCE_MS = 50;

export function createLifecycleEventHandlers(deps: LifecycleEventHandlerDeps): LifecycleEventHandlers {
  // Per-chat coalescing for external CHAT_CHANGED bursts (50ms debounce).
  const chatChangedDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const chatChangedCoalescedCount = new Map<string, number>();
  const chatChangedCoalescedFields = new Map<string, Set<string> | 'unknown'>();

  function scheduleChatChangedRefresh(
    chatId: string,
    characterId: string | null,
    changedFields: readonly string[] | undefined,
    userId: string | undefined,
  ): void {
    chatChangedCoalescedCount.set(chatId, (chatChangedCoalescedCount.get(chatId) ?? 0) + 1);
    const prev = chatChangedCoalescedFields.get(chatId);
    if (changedFields === undefined) {
      chatChangedCoalescedFields.set(chatId, 'unknown');
    } else if (prev !== 'unknown') {
      const merged = (prev instanceof Set) ? prev : new Set<string>();
      for (const f of changedFields) merged.add(f);
      chatChangedCoalescedFields.set(chatId, merged);
    }

    if (chatChangedDebounceTimers.has(chatId)) return;
    const timer = setTimeout(async () => {
      chatChangedDebounceTimers.delete(chatId);
      const coalesced = chatChangedCoalescedCount.get(chatId) ?? 1;
      chatChangedCoalescedCount.delete(chatId);
      const accumulatedFields = chatChangedCoalescedFields.get(chatId) ?? 'unknown';
      chatChangedCoalescedFields.delete(chatId);
      const requiresRefresh = changedFieldsRequireRefresh(accumulatedFields);
      try {
        const active = await deps.ensureActiveCardForChat(chatId, characterId, userId);
        const fieldsSummary = accumulatedFields === 'unknown'
          ? 'unknown'
          : (accumulatedFields.size === 0 ? 'empty' : `[${[...accumulatedFields].slice(0, 6).join(',')}${accumulatedFields.size > 6 ? `,+${accumulatedFields.size - 6}` : ''}]`);
        deps.log.info(
          `CHAT_CHANGED (external, debounced): coalesced=${coalesced} ` +
            `fields=${fieldsSummary} requiresRefresh=${requiresRefresh} ` +
            `active=${active ? `char=${active.card.character_id}` : '<none>'}`,
        );
        if (!active) {
          try { deps.send({ type: 'clear_bg_html', chatId }, userId); }
          catch (err) { deps.log.warn(`CHAT_CHANGED clear_bg_html: ${(err as Error).message}`); }
          return;
        }
        if (!requiresRefresh) return;
        // Snapshot before bg-html (see SETTINGS_UPDATED activeChatId rationale).
        await deps.refreshVariables(active, chatId, userId, { force: true });
        await deps.refreshBgHtml(active, chatId, userId);
      } catch (err) {
        deps.log.error(`scheduleChatChangedRefresh: chat=${chatId} threw: ${deps.errMsg(err)}`);
      }
    }, CHAT_CHANGED_DEBOUNCE_MS);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    chatChangedDebounceTimers.set(chatId, timer);
  }

  // World-book entry edits via Lumi's UI emit no character/chat event, so
  // cached {{lorebook}} would go stale. Edits are rare, so coarse per-user
  // invalidation (drop derived caches + reactivate, which repopulates the
  // lorebook cache via ensureActiveCardForChat) is sufficient and dodges the
  // worldBookId→character mapping gap for module-shared books.
  function onWorldBookMutation(userId: string | undefined): void {
    deps.captureUserId(userId, 'WORLD_BOOK');
    if (userId === undefined) return;
    const affected = new Set<string>();
    for (const [chatId, active] of [...deps.activeCardByChat]) {
      if (active.ownerUserId !== userId) continue;
      affected.add(active.card.character_id);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      deps.invalidateListenEditPreload(chatId);
    }
    for (const cid of affected) deps.invalidateActiveForCharacter(cid, userId);
    deps.log.info(`event WORLD_BOOK mutation user=${userId} chars=${affected.size}`);
  }

  return {
    SETTINGS_UPDATED: async (raw, userId) => {
      deps.captureUserId(userId, 'SETTINGS_UPDATED');
      const p = raw as { key?: string; value?: unknown; keys?: string[] };
      if (p.key !== 'activeChatId') return;
      const chatId = typeof p.value === 'string' && p.value.length > 0 ? p.value : null;
      deps.log.info(`event SETTINGS_UPDATED activeChatId=${chatId ?? '<cleared>'} payload=${deps.dumpPayload(raw)}`);
      const prevChat = userId ? deps.lastActiveChatByUser.get(userId) : undefined;
      // FE dismounts on any render/clear for a different chat, both prev and new memos are stale at the moment of transition.
      if (prevChat !== chatId) {
        if (prevChat) deps.lastSentBgHtmlByChat.delete(prevChat);
        if (chatId) deps.lastSentBgHtmlByChat.delete(chatId);
      }
      if (!chatId) {
        deps.sendSetActiveChat(null, null, userId);
        const lastChat = userId ? deps.lastActiveChatByUser.get(userId) : undefined;
        if (lastChat) {
          deps.log.info(
            `SETTINGS_UPDATED activeChatId cleared, dismounting bg-host for last chat=${lastChat}`,
          );
          try { deps.send({ type: 'clear_bg_html', chatId: lastChat }, userId); }
          catch (err) { deps.log.warn(`SETTINGS_UPDATED clear_bg_html: ${(err as Error).message}`); }
          if (userId) deps.lastActiveChatByUser.delete(userId);
        } else {
          deps.log.info(`SETTINGS_UPDATED activeChatId cleared, no last chat to dismount`);
        }
        return;
      }
      if (userId) deps.lastActiveChatByUser.set(userId, chatId);
      let characterId: string | undefined;
      try {
        const chat = await deps.chatsGet(chatId, userId);
        if (chat?.character_id) characterId = chat.character_id;
      } catch (err) {
        deps.log.warn(`SETTINGS_UPDATED activeChatId: chats.get failed: ${(err as Error).message}`);
      }
      const active = await deps.ensureActiveCardForChat(chatId, characterId ?? null, userId);
      deps.log.info(`SETTINGS_UPDATED activeChatId: active=${active ? `characterId=${active.card.character_id} hasBgHtml=${!!active.card.risuPayload.background_html} triggers=${active.card.risuPayload.triggers?.length ?? 0}` : '<none>'}`);
      deps.sendSetActiveChat(active ? chatId : null, active ? active.card.character_id : null, userId);
      if (!active) {
        try { deps.send({ type: 'clear_bg_html', chatId }, userId); } catch { /* */ }
        return;
      }
      // Card-authored position:fixed needs viewport scope, opt the chat out of
      // Lumi's bubble-CB sandbox. Gated by app_manipulation per Lumi side.
      deps.setChatStyleMode(chatId, 'extension-relaxed', userId);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      void deps.refreshMessagesCache(chatId, userId);
      // Push the display snapshot FIRST: the FE resolver needs it to render and
      // waits on it. bg-html is only styling and can take seconds — running it
      // first (as it used to) queued the snapshot behind it, so the FE sat on a
      // not-ready resolver for ~5s. Snapshot before bg-html.
      await deps.refreshVariables(active, chatId, userId, { force: true });
      await deps.refreshToggleDefinitions(active, chatId, userId, { force: true });
      await deps.refreshBgHtml(active, chatId, userId);
      deps.log.info(`SETTINGS_UPDATED activeChatId: ALL DONE chatId=${chatId}`);
    },

    CHAT_CHANGED: async (raw, userId) => {
      deps.captureUserId(userId, 'CHAT_CHANGED');
      const { chatId, characterId } = deps.extractIds(raw);
      if (!chatId) { deps.log.warn('CHAT_CHANGED: missing chatId , aborting'); return; }
      const changedFields = (raw as { changedFields?: readonly string[] }).changedFields;
      const requiresRefresh = changedFieldsRequireRefresh(
        changedFields === undefined ? 'unknown' : new Set(changedFields),
      );
      const wasOwn = deps.consumeOwnChatChange(chatId);
      if (requiresRefresh) {
        deps.invalidateListenEditPreload(chatId);
        deps.invalidateRenderMcpForChat(chatId);
        deps.invalidateMacroInterceptorForChat(chatId);
        // Own runtime.flush already updated this cache, only external writes need the drop.
        if (!wasOwn) invalidateRecentFlush(chatId);
        if (!wasOwn) deps.clearVarOverlay(chatId);
        if (!wasOwn) deps.clearMacroVarOverlay(chatId);
      }
      const fieldsPreview = changedFields === undefined
        ? 'undefined'
        : (changedFields.length === 0 ? 'empty' : `[${changedFields.slice(0, 4).join(',')}${changedFields.length > 4 ? `,+${changedFields.length - 4}` : ''}]`);
      deps.log.info(
        `event CHAT_CHANGED chatId=${chatId} characterId=${characterId ?? '?'} ` +
          `ownWrite=${wasOwn} fields=${fieldsPreview} requiresRefresh=${requiresRefresh}`,
      );
      if (wasOwn) {
        await deps.ensureActiveCardForChat(chatId, characterId, userId);
        return;
      }
      scheduleChatChangedRefresh(chatId, characterId, changedFields, userId);
    },

    MESSAGE_SENT: async (raw, userId) => {
      deps.captureUserId(userId, 'MESSAGE_SENT');
      const { chatId, characterId } = deps.extractIds(raw);
      deps.log.info(`event MESSAGE_SENT chatId=${chatId ?? '?'} characterId=${characterId ?? '?'} payload=${deps.dumpPayload(raw)}`);
      if (!chatId) return;
      deps.invalidateListenEditPreload(chatId);
      void deps.refreshMessagesCache(chatId, userId);
      const active = await deps.ensureActiveCardForChat(chatId, characterId, userId);
      if (!active) { deps.log.info(`MESSAGE_SENT: no active card , skip`); return; }
      await deps.refreshVariables(active, chatId, userId);
    },

    GENERATION_STARTED: async (raw, userId) => {
      deps.captureUserId(userId, 'GENERATION_STARTED');
      const { chatId, characterId } = deps.extractIds(raw);
      deps.log.info(`event GENERATION_STARTED chatId=${chatId ?? '?'} characterId=${characterId ?? '?'} payload=${deps.dumpPayload(raw)}`);
      if (!chatId) return;
      const active = await deps.ensureActiveCardForChat(chatId, characterId, userId);
      if (!active) return;
      deps.log.info(`GENERATION_STARTED: → runBinding(start)`);
      await deps.runBinding(active, chatId, 'start', userId);
      deps.log.info(`GENERATION_STARTED: → runBinding(request)`);
      await deps.runBinding(active, chatId, 'request', userId);
      // Risu runCurrentChatFunction at sendChat start (pre-prompt-assembly).
      if (userId !== undefined) await deps.runMessageVarPass(chatId, active.card.character_id, userId);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      await deps.refreshBgHtml(active, chatId, userId);
      await deps.refreshVariables(active, chatId, userId);
    },

    GENERATION_ENDED: async (raw, userId) => {
      deps.captureUserId(userId, 'GENERATION_ENDED');
      const { chatId, characterId } = deps.extractIds(raw);
      deps.log.info(`event GENERATION_ENDED chatId=${chatId ?? '?'} characterId=${characterId ?? '?'} payload=${deps.dumpPayload(raw)}`);
      if (!chatId) return;
      const active = await deps.ensureActiveCardForChat(chatId, characterId, userId);
      if (!active) return;
      for (const binding of deps.generationEndedBindings) {
        await deps.runBinding(active, chatId, binding, userId);
      }
      // Risu runCurrentChatFunction post-output, catches the new AI message.
      if (userId !== undefined) await deps.runMessageVarPass(chatId, active.card.character_id, userId);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      void deps.refreshMessagesCache(chatId, userId);
      await deps.refreshBgHtml(active, chatId, userId);
      await deps.refreshVariables(active, chatId, userId);
    },

    GENERATION_STOPPED: async (raw, userId) => {
      deps.captureUserId(userId, 'GENERATION_STOPPED');
      const { chatId, characterId } = deps.extractIds(raw);
      deps.log.info(`event GENERATION_STOPPED chatId=${chatId ?? '?'} characterId=${characterId ?? '?'} payload=${deps.dumpPayload(raw)}`);
      if (!chatId) return;
      const active = await deps.ensureActiveCardForChat(chatId, characterId, userId);
      if (!active) return;
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      await deps.refreshBgHtml(active, chatId, userId);
      await deps.refreshVariables(active, chatId, userId);
    },

    MESSAGE_SWIPED: async (raw, userId) => {
      deps.captureUserId(userId, 'MESSAGE_SWIPED');
      const p = raw as {
        chatId?: string;
        message?: { id?: string; chat_id?: string; content?: string };
        action?: string;
      };
      const chatId = p.chatId ?? p.message?.chat_id ?? null;
      const msgId = p.message?.id ?? null;
      deps.log.info(`event MESSAGE_SWIPED chatId=${chatId ?? '?'} msgId=${msgId ?? '?'} action=${p.action ?? '?'}`);
      if (!chatId || !msgId) return;
      deps.invalidateListenEditPreload(chatId);
      deps.invalidateRenderMcpForMessage(chatId, msgId);
      void deps.refreshMessagesCache(chatId, userId);
      const active = await deps.ensureActiveCardForChat(chatId, null, userId);
      if (!active) return;
      // No output/display bindings on swipe, Risu fires output triggers
      // inside sendChat, not on the swipe primitive itself.
      await deps.refreshBgHtml(active, chatId, userId);
      await deps.refreshVariables(active, chatId, userId);
    },

    MESSAGE_EDITED: async (raw, userId) => {
      deps.captureUserId(userId, 'MESSAGE_EDITED');
      const p = raw as MessageEditedPayload;
      const chatId = p.chatId ?? p.message?.chat_id ?? null;
      const msgId = p.message?.id ?? null;
      if (chatId) deps.invalidateListenEditPreload(chatId);
      if (!chatId || !msgId) {
        deps.log.warn(`event MESSAGE_EDITED: missing chatId/msgId payload=${JSON.stringify(raw).slice(0, 200)}`);
        return;
      }
      deps.invalidateRenderMcpForMessage(chatId, msgId);
      void deps.refreshMessagesCache(chatId, userId);
      const newContent = String(p.message?.content ?? '');
      // Self-echo: own writes (Lua setChat, editOutput writeback) called
      // rememberOurWrite before editMessage, filter the echo here.
      if (deps.consumeIfOurWrite(chatId, msgId, newContent)) return;
      const editedBy = readEditedBy(p);
      deps.log.info(`event MESSAGE_EDITED (external) chatId=${chatId} msgId=${msgId} editedBy=${editedBy ?? '<none>'} len=${newContent.length}`);
    },

    MESSAGE_DELETED: async (raw, userId) => {
      deps.captureUserId(userId, 'MESSAGE_DELETED');
      const p = raw as { chatId?: string; messageId?: string; message?: { id?: string; chat_id?: string } };
      const chatId = p.chatId ?? p.message?.chat_id ?? null;
      const msgId = p.messageId ?? p.message?.id ?? null;
      deps.log.info(`event MESSAGE_DELETED chatId=${chatId ?? '?'} msgId=${msgId ?? '?'}`);
      if (!chatId) return;
      deps.invalidateListenEditPreload(chatId);
      if (msgId) deps.invalidateRenderMcpForMessage(chatId, msgId);
      await deps.refreshMessagesCache(chatId, userId);
      const active = await deps.ensureActiveCardForChat(chatId, null, userId);
      if (!active) return;
      // No bindings fire here, Risu has no binding-firing analogue for deletes.
      await deps.refreshBgHtml(active, chatId, userId);
      await deps.refreshVariables(active, chatId, userId);
    },

    CHAT_DELETED: async (raw, userId) => {
      deps.captureUserId(userId, 'CHAT_DELETED');
      const p = raw as { id?: string; chatId?: string };
      const chatId = p.chatId ?? p.id ?? null;
      deps.log.info(`event CHAT_DELETED chatId=${chatId ?? '?'}`);
      if (!chatId) return;
      deps.invalidateListenEditPreload(chatId);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
      deps.invalidateMessagesCache(chatId);
      invalidateRecentFlush(chatId);
      deps.lastSentBgHtmlByChat.delete(chatId);
      deps.activeCardByChat.delete(chatId);
      deps.onActiveChatEvicted?.(chatId);
      deps.clearActiveAssetIndexes(chatId);
      deps.clearActiveCharacterImage(chatId);
      deps.clearActiveScriptstateDefaults(chatId);
      deps.clearActiveLorebook(chatId);
      deps.clearVarOverlay(chatId);
      deps.clearMacroVarOverlay(chatId);
      deps.variableState.clearChat(chatId);
      deps.toggleState.clearChat(chatId);
    },

    CHARACTER_DELETED: async (raw, uid) => {
      deps.captureUserId(uid, 'CHARACTER_DELETED');
      const characterId =
        (raw as { id?: string }).id
        ?? deps.extractIds(raw).characterId
        ?? null;
      deps.log.info(`event CHARACTER_DELETED characterId=${characterId ?? '?'}`);
      if (!characterId) return;
      deps.compiledByCharacter.delete(characterId);
      const cachedWorldBookIds = deps.worldBookIdsByCharacter.get(characterId) ?? [];
      deps.worldBookIdsByCharacter.delete(characterId);
      await deps.deleteCardByChar(characterId, uid, 'cascade');

      if (uid) {
        const lastChat = deps.lastActiveChatByUser.get(uid);
        if (lastChat) {
          const stillActive = await deps.ensureActiveCardForChat(lastChat, null, uid).catch(() => null);
          if (!stillActive) deps.sendSetActiveChat(null, null, uid);
        }
      }

      if (uid) {
        const opId = `delete-char-${characterId}-${Date.now()}`;
        const opTitle = `Cleaning up deleted character`;
        deps.emitOperationProgress(uid, opId, 'started', opTitle, 'Reading image journal…', null);
        try {
          const journalFile = await deps.readImageJournalFile(deps.journalStorage(), uid, characterId);
          const journalImageIds = journalFile?.imageIds ?? [];
          let imageStats = { deleted: 0, absent: 0, failed: 0, skipped: 0 };
          if (journalImageIds.length === 0) {
            deps.log.info(`CHARACTER_DELETED: no journal for char=${characterId}, nothing to clean`);
          } else {
            deps.emitOperationProgress(
              uid, opId, 'progress', opTitle,
              `Checking ${journalImageIds.length} asset${journalImageIds.length === 1 ? '' : 's'} against live references…`,
              0.3,
            );
            // Lumi fires CHARACTER_DELETED BEFORE the row is removed, the
            // doomed character still passes through listLumirealmCharacters,
            // exclude it explicitly so its asset_index doesn't shield its own IDs.
            const live = await deps.buildLiveImageIdSet(deps.buildOrphanDetectDepsExcluding(uid, characterId));
            const safeIds: string[] = [];
            let skipped = 0;
            for (const id of journalImageIds) {
              if (typeof id !== 'string' || id.length === 0) continue;
              if (live.liveIds.has(id)) {
                skipped++;
                continue;
              }
              safeIds.push(id);
            }
            if (skipped > 0) {
              deps.log.info(
                `CHARACTER_DELETED: ${skipped}/${journalImageIds.length} asset(s) shielded by other live refs ` +
                  `(likely a Lumi-side duplicate), deleting only ${safeIds.length} character-owned asset(s)`,
              );
            }
            if (safeIds.length > 0) {
              deps.emitOperationProgress(
                uid, opId, 'progress', opTitle,
                `Deleting 0 of ${safeIds.length} asset${safeIds.length === 1 ? '' : 's'}…`,
                0.4,
              );
              const stats = await deps.deleteImageIds(
                safeIds, uid, `CHARACTER_DELETED(${characterId})`,
                (processed, total) => {
                  const frac = total > 0 ? 0.4 + (processed / total) * 0.55 : 0.4;
                  deps.emitOperationProgress(
                    uid, opId, 'progress', opTitle,
                    `Deleting ${processed} of ${total} asset${total === 1 ? '' : 's'}…`,
                    frac,
                  );
                },
              );
              imageStats = { ...stats, skipped };
            } else {
              imageStats = { deleted: 0, absent: 0, failed: 0, skipped };
            }
          }
          await deps.clearImageJournal(deps.journalStorage(), uid, characterId).catch((err) => {
            deps.log.warn(`CHARACTER_DELETED: clearImageJournal threw char=${characterId}: ${deps.errMsg(err)}`);
          });
          deps.log.info(
            `CHARACTER_DELETED cleanup: char=${characterId} ` +
              `imageDelete=deleted:${imageStats.deleted} absent:${imageStats.absent} ` +
              `failed:${imageStats.failed} skipped:${imageStats.skipped}`,
          );
          const summaryLine = journalImageIds.length === 0
            ? 'No image assets to clean'
            : imageStats.skipped > 0
              ? `${imageStats.deleted} asset${imageStats.deleted === 1 ? '' : 's'} deleted (${imageStats.skipped} kept, still referenced)`
              : `${imageStats.deleted} asset${imageStats.deleted === 1 ? '' : 's'} deleted`;
          deps.emitOperationProgress(uid, opId, 'done', opTitle, summaryLine, 1);
        } catch (err) {
          deps.log.warn(`CHARACTER_DELETED cleanup threw char=${characterId}: ${deps.errMsg(err)}`);
          deps.emitOperationProgress(uid, opId, 'error', opTitle, '', null, deps.errMsg(err));
          // Best-effort journal clear so the boot detector doesn't keep flagging.
          await deps.clearImageJournal(deps.journalStorage(), uid, characterId).catch(() => { /* */ });
        }
      }

      deps.send({
        type: 'cleanup_character_artifacts',
        characterId,
        worldBookIds: cachedWorldBookIds,
      }, uid);
    },

    CHARACTER_CREATED: async (raw, userId) => {
      deps.captureUserId(userId, 'CHARACTER_CREATED');
      const characterId =
        (raw as { id?: string }).id
        ?? deps.extractIds(raw).characterId
        ?? null;
      deps.log.info(`event CHARACTER_CREATED characterId=${characterId ?? '?'}`);
      try {
        deps.pushCards(await deps.listCards(userId), userId);
      } catch (err) {
        deps.log.warn(`CHARACTER_CREATED: pushCards failed: ${deps.errMsg(err)}`);
      }
    },

    CHARACTER_EDITED: async (raw, userId) => {
      deps.captureUserId(userId, 'CHARACTER_EDITED');
      const characterId =
        (raw as { id?: string }).id
        ?? deps.extractIds(raw).characterId
        ?? null;
      if (!characterId) {
        deps.log.warn(`event CHARACTER_EDITED: missing id payload=${deps.dumpPayload(raw)}`);
        return;
      }
      const wasOwn = deps.consumeOwnCharacterEdit(characterId);
      deps.log.info(`event CHARACTER_EDITED characterId=${characterId} ownWrite=${wasOwn}`);
      if (wasOwn) return;
      deps.invalidateActiveForCharacter(characterId, userId);
      try {
        deps.pushCards(await deps.listCards(userId), userId);
      } catch (err) {
        deps.log.warn(`CHARACTER_EDITED: pushCards failed: ${deps.errMsg(err)}`);
      }
    },

    WORLD_BOOK_CHANGED: async (_raw, userId) => { onWorldBookMutation(userId); },
    WORLD_BOOK_DELETED: async (_raw, userId) => { onWorldBookMutation(userId); },
    WORLD_BOOK_ENTRY_CHANGED: async (_raw, userId) => { onWorldBookMutation(userId); },
    WORLD_BOOK_ENTRY_DELETED: async (_raw, userId) => { onWorldBookMutation(userId); },
  };
}
