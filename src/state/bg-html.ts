import type { ActiveCard } from '../interpreter/dispatch.js';
import type { BackendToFrontend } from '../types/messages.js';

export interface BgHtmlRefresherDeps {
  readonly resolveReadonly: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean },
  ) => Promise<string>;
  readonly lastSentBgHtmlByChat: Map<string, string>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
    readonly debug: (m: string) => void;
  };
}

export interface BgHtmlRefresher {
  readonly refresh: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    isCurrent?: () => boolean,
  ) => Promise<void>;
}

export function createBgHtmlRefresher(deps: BgHtmlRefresherDeps): BgHtmlRefresher {
  const { resolveReadonly, lastSentBgHtmlByChat, send, log } = deps;

  async function refresh(
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    isCurrent?: () => boolean,
  ): Promise<void> {
    const bgRaw = active.card.risuPayload.background_html;
    const moduleBg = active.card.risuPayload.module_background_embedding ?? '';
    const bgCombined = (bgRaw ?? '') + (moduleBg.length > 0 ? '\n' + moduleBg : '');
    const characterId = active.card.character_id;

    log.debug(
      `refreshBgHtml: START chatId=${chatId} bgRaw_len=${bgRaw?.length ?? 0} ` +
        `moduleBg_len=${moduleBg.length} bgCombined_len=${bgCombined.length}`,
    );

    const tResolve = Date.now();
    if (userId === undefined) {
      log.warn(`refreshBgHtml: userId not captured for chatId=${chatId}, skipping`);
      return;
    }
    let resolvedBg = '';
    try {
      resolvedBg = bgCombined.length > 0
        ? await resolveReadonly(bgCombined, chatId, characterId, userId)
        : '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`refreshBgHtml: resolve failed chatId=${chatId}: ${msg}`);
      return;
    }
    if (isCurrent?.() === false) return;
    const elapsed = Date.now() - tResolve;

    log.debug(
      `refreshBgHtml: resolved chatId=${chatId} bg_in=${bgCombined.length} ` +
        `bg_out=${resolvedBg.length} ` +
        `elapsed=${elapsed}ms`,
    );
    const sig = resolvedBg;
    const prior = lastSentBgHtmlByChat.get(chatId);
    if (prior === sig) {
      log.debug(
        `refreshBgHtml: skip redundant send chatId=${chatId} (signature matches prior) ` +
          `bg_out=${resolvedBg.length}`,
      );
      return;
    }
    lastSentBgHtmlByChat.set(chatId, sig);
    try {
      send({
        type: 'render_bg_html',
        chatId,
        bgHtml: resolvedBg,
      }, userId);
      log.debug(`refreshBgHtml: sendToFrontend render_bg_html OK chatId=${chatId}`);
    } catch (err) {
      log.warn(`refreshBgHtml: send failed: ${(err as Error).message}`);
    }
  }

  return { refresh };
}
