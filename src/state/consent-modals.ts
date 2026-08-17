import type {
  BackendToFrontend,
  CardSummary,
} from '../types/messages.js';
import type {
  SpindleAPI,
} from 'lumiverse-spindle-types';
import type { ActiveCard } from '../interpreter/dispatch.js';
import { clearActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { clearActiveCharacterImage } from '../interpreter/image-cache.js';

interface PendingConsent {
  readonly ownerUserId: string;
  readonly resolver: (confirmed: boolean) => void;
}

// Self-heal window for stuck FE: a disconnected client never replies, without this timeout the per-user consent chain blocks every later prompt forever.
const CONSENT_TIMEOUT_MS = 5 * 60_000;

export interface ConsentApi {
  readonly requestConsent: (
    opts: { title: string; message: string; confirmLabel: string; cancelLabel: string },
    userId: string,
  ) => Promise<{ confirmed: boolean }>;
  readonly pendingConsents: Map<string, PendingConsent>;
}

export interface ConsentApiDeps {
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
}

export function createConsentApi(deps: ConsentApiDeps): ConsentApi {
  const { send, log } = deps;
  const pendingConsents = new Map<string, PendingConsent>();
  // Per-user serialization, user A's consent prompt must not block user B's.
  const consentChainByUser = new Map<string, Promise<unknown>>();

  function requestConsent(
    opts: { title: string; message: string; confirmLabel: string; cancelLabel: string },
    userId: string,
  ): Promise<{ confirmed: boolean }> {
    const run = (): Promise<{ confirmed: boolean }> =>
      new Promise((resolve) => {
        const requestId = crypto.randomUUID();
        const timeoutHandle = setTimeout(() => {
          if (!pendingConsents.has(requestId)) return;
          pendingConsents.delete(requestId);
          log.warn(`requestConsent: timed out requestId=${requestId} userId=${userId} (auto-decline)`);
          resolve({ confirmed: false });
        }, CONSENT_TIMEOUT_MS);
        if (typeof (timeoutHandle as { unref?: () => void }).unref === 'function') {
          (timeoutHandle as { unref: () => void }).unref();
        }
        pendingConsents.set(requestId, {
          ownerUserId: userId,
          resolver: (confirmed) => {
            clearTimeout(timeoutHandle);
            resolve({ confirmed });
          },
        });
        send({
          type: 'consent_prompt',
          requestId,
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel,
          cancelLabel: opts.cancelLabel,
        }, userId);
        log.info(`requestConsent: dispatched requestId=${requestId} userId=${userId} title="${opts.title}"`);
      });
    const prior = consentChainByUser.get(userId) ?? Promise.resolve();
    const result = prior.then(run, run);
    consentChainByUser.set(userId, result.catch(() => undefined));
    return result;
  }

  return { requestConsent, pendingConsents };
}

export interface ModalConfirmDeps {
  readonly confirmModal: SpindleAPI['modal']['confirm'];
  readonly log: { readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export type ModalConfirmOptions = Parameters<SpindleAPI['modal']['confirm']>[0];

export function makeQueueModalConfirm(deps: ModalConfirmDeps): (
  userId: string,
  options: Omit<ModalConfirmOptions, 'userId'>,
) => Promise<{ confirmed: boolean } | null> {
  const { confirmModal, log, errMsg } = deps;
  const modalChainByUser = new Map<string, Promise<unknown>>();

  return (userId, options) => {
    const run = (): Promise<{ confirmed: boolean } | null> =>
      confirmModal({ ...options, userId }).catch((err) => {
        log.warn(`queueModalConfirm: modal.confirm threw: ${errMsg(err)}`);
        return null;
      });
    const prior = modalChainByUser.get(userId) ?? Promise.resolve();
    const next = prior.then(run, run);
    modalChainByUser.set(userId, next.catch(() => undefined));
    return next;
  };
}

export interface DeleteCardDeps {
  readonly clearLumirealm: (characterId: string, userId: string) => Promise<boolean>;
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly compiledByCharacter: Map<string, unknown>;
  readonly variableState: { clearChat: (chatId: string) => void };
  readonly toggleState: { clearChat: (chatId: string) => void };
  readonly listCards: (userId: string | undefined) => Promise<readonly CardSummary[]>;
  readonly pushCards: (cards: readonly CardSummary[], userId: string | undefined) => void;
  readonly onActiveChatEvicted?: (chatId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
}

export function makeDeleteCardByChar(deps: DeleteCardDeps): (
  characterId: string,
  userId: string | undefined,
  mode?: 'soft' | 'cascade',
) => Promise<void> {
  const {
    clearLumirealm,
    activeCardByChat,
    compiledByCharacter,
    variableState,
    toggleState,
    listCards,
    pushCards,
    onActiveChatEvicted,
    log,
  } = deps;

  return async (characterId, userId, mode = 'cascade') => {
    // userId may be a mode-string from a stale caller. TS doesn't catch when both args are string, so reject obvious mismatches at runtime.
    if (userId === 'soft' || userId === 'cascade') {
      throw new Error(`deleteCardByChar: userId="${userId}" looks like a mode value, caller likely passed args in old order`);
    }
    log.info(`deleteCardByChar: start characterId=${characterId} mode=${mode}`);
    if (mode === 'soft') {
      if (userId !== undefined) {
        const ok = await clearLumirealm(characterId, userId);
        log.info(`deleteCardByChar: clearLumirealm ok=${ok}`);
      } else {
        log.warn(`deleteCardByChar: soft remove skipped,userId not yet captured for char=${characterId}`);
      }
    }
    // Evict cached active-card entries owned by the same user only so user B's delete can't wipe user A's cache. Skip when userId unknown.
    let evictedChats = 0;
    if (userId !== undefined) {
      for (const [chatId, active] of activeCardByChat) {
        if (active.card.character_id === characterId && active.ownerUserId === userId) {
          activeCardByChat.delete(chatId);
          onActiveChatEvicted?.(chatId);
          clearActiveAssetIndexes(chatId);
          clearActiveCharacterImage(chatId);
          variableState.clearChat(chatId);
          toggleState.clearChat(chatId);
          evictedChats += 1;
        }
      }
    }
    // characterIds are Lumi-wide unique UUIDs so the compiled-trigger cache is safe to evict from any context (no cross-user collision possible).
    const compiledEvicted = compiledByCharacter.delete(characterId);
    log.info(`deleteCardByChar: evicted activeCard entries=${evictedChats} compiled=${compiledEvicted}`);
    // CHARACTER_DELETED fires before the row is removed, filter defensively.
    const fresh = await listCards(userId);
    const filtered = fresh.filter((c) => c.character_id !== characterId);
    pushCards(filtered, userId);
  };
}
