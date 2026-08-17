import type { CardSummary } from '../types/messages.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import type { HostVersionCheckResult } from '../util/version-check.js';
import type { Handler } from './types.js';

export interface PendingImportCompletion {
  hasPendingSvgRaster: boolean;
  characterName: string;
  startedAt: number;
  ownerUserId: string;
}

export type OperationPhase = 'started' | 'progress' | 'done' | 'error';

export interface ImportHandlerDeps {
  readonly pendingImportCompletions: Map<string, PendingImportCompletion>;
  readonly lastSentBgHtmlByChat: Map<string, string>;
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly lastActiveChatByUser: Map<string, string>;
  readonly hostVersionCheck: HostVersionCheckResult;
  readonly getMissingPermissions: () => readonly string[];
  readonly permissionPurpose: Readonly<Record<string, string>>;
  readonly listCards: (userId: string) => Promise<readonly CardSummary[]>;
  readonly pushCards: (cards: readonly CardSummary[], userId: string) => void;
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string,
  ) => Promise<ActiveCard | null>;
  readonly sendSetActiveChat: (
    activeChatId: string | null,
    activeCharacterId: string | null,
    userId: string,
  ) => void;
  readonly invalidateRenderMcpForChat: (chatId: string) => void;
  readonly invalidateMacroInterceptorForChat: (chatId: string) => void;
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string) => Promise<void>;
  readonly refreshVariables: (
    active: ActiveCard,
    chatId: string,
    userId: string,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly importAnyFormat: (bytes: Uint8Array, fileName: string, userId: string) => Promise<void>;
  readonly getUpload: (
    uploadId: string,
    userId: string,
  ) => Promise<{ fileName: string; size: number; data: Uint8Array } | null>;
  readonly deleteUpload: (uploadId: string, userId: string) => Promise<boolean>;
  readonly applySvgRasterIndex: (args: {
    characterId: string;
    imageIdByMarker: Readonly<Record<string, string | null>>;
    userId: string;
  }) => Promise<void>;
  readonly maybeFinalizeImport: (characterId: string) => Promise<void>;
  readonly characterGet: (characterId: string, userId: string) => Promise<{ name?: string } | null>;
  readonly deleteCardByChar: (characterId: string, userId: string, mode: 'soft' | 'cascade') => Promise<void>;
  readonly emitOperationProgress: (
    userId: string,
    operationId: string,
    phase: OperationPhase,
    title: string,
    message: string,
    fraction: number | null,
    error?: string,
  ) => void;
  readonly notifyHostVersionOutdated: (msg: unknown, userId: string) => void;
  readonly notifyMissingPermissions: (msg: unknown, userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void; readonly error: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

// Coalesce concurrent get_cards per user. The FE handshake retries get_cards
// until cards_updated lands, and each runs a heavy listCards + bg-html re-paint
// that would otherwise pile onto the single worker and saturate it.
const getCardsInFlight = new Set<string>();

export function createImportHandlers(deps: ImportHandlerDeps): {
  readonly get_cards: Handler<'get_cards'>;
  readonly import_card_from_upload: Handler<'import_card_from_upload'>;
  readonly register_svg_raster_index: Handler<'register_svg_raster_index'>;
  readonly delete_card: Handler<'delete_card'>;
} {
  return {
    get_cards: async (_msg, ctx) => {
      if (ctx.userId && getCardsInFlight.has(ctx.userId)) {
        deps.log.info(`get_cards: coalesced (already in flight) userId=${ctx.userId}`);
        return;
      }
      if (ctx.userId) getCardsInFlight.add(ctx.userId);
      try {
        const hostVersionCheck = deps.hostVersionCheck;
        if (hostVersionCheck.needsUpdate) {
          deps.notifyHostVersionOutdated({
            type: 'notify_host_version_outdated',
            hostVersion: hostVersionCheck.hostVersion,
            minimum: hostVersionCheck.minimum,
            message: hostVersionCheck.message,
          }, ctx.userId);
        }
        const missingPerms = deps.getMissingPermissions();
        if (missingPerms.length > 0) {
          const purposes: Record<string, string> = {};
          for (const p of missingPerms) purposes[p] = deps.permissionPurpose[p] ?? p;
          deps.log.warn(`get_cards: pushing notify_missing_permissions missing=[${missingPerms.join(',')}] userId=${ctx.userId}`);
          deps.notifyMissingPermissions({
            type: 'notify_missing_permissions',
            missing: missingPerms,
            purposes,
          }, ctx.userId);
        }
        let cleared = 0;
        for (const [chatId] of deps.lastSentBgHtmlByChat) {
          const active = deps.activeCardByChat.get(chatId);
          if (active && active.ownerUserId === ctx.userId) {
            deps.lastSentBgHtmlByChat.delete(chatId);
            cleared++;
          }
        }
        const lastChatHint = deps.lastActiveChatByUser.get(ctx.userId);
        if (lastChatHint && deps.lastSentBgHtmlByChat.delete(lastChatHint)) cleared++;
        if (cleared > 0) {
          deps.log.info(`get_cards: cleared ${cleared} bg-html send memo(s) for FE remount`);
        }
        deps.pushCards(await deps.listCards(ctx.userId), ctx.userId);
        const lastChat = deps.lastActiveChatByUser.get(ctx.userId);
        if (lastChat) {
          deps.log.info(`get_cards: re-painting bg+scope-css for lastChat=${lastChat} userId=${ctx.userId}`);
          try {
            const active = await deps.ensureActiveCardForChat(lastChat, null, ctx.userId);
            deps.sendSetActiveChat(
              active ? lastChat : null,
              active ? active.card.character_id : null,
              ctx.userId,
            );
            if (active) {
              deps.invalidateRenderMcpForChat(lastChat);
              deps.invalidateMacroInterceptorForChat(lastChat);
              await deps.refreshBgHtml(active, lastChat, ctx.userId);
              await deps.refreshVariables(active, lastChat, ctx.userId, { force: true });
            }
          } catch (err) {
            deps.log.warn(`get_cards: rehydrate failed chat=${lastChat}: ${deps.errMsg(err)}`);
          }
        } else {
          deps.sendSetActiveChat(null, null, ctx.userId);
        }
      } finally {
        if (ctx.userId) getCardsInFlight.delete(ctx.userId);
      }
    },
    import_card_from_upload: async (msg, ctx) => {
      deps.log.info(`import_card_from_upload: uploadId=${msg.uploadId} file=${msg.fileName} userId=${ctx.userId}`);
      let upload: { fileName: string; size: number; data: Uint8Array } | null;
      try {
        upload = await deps.getUpload(msg.uploadId, ctx.userId);
      } catch (err) {
        deps.log.error(`import_card_from_upload: getUpload threw: ${deps.errMsg(err)}`);
        ctx.send({ type: 'import_progress', phase: 'error', message: 'Upload retrieval failed', fraction: null, error: deps.errMsg(err) }, ctx.userId);
        return;
      }
      if (!upload) {
        deps.log.warn(`import_card_from_upload: uploadId=${msg.uploadId} not found or expired`);
        ctx.send({ type: 'import_progress', phase: 'error', message: 'Upload not found or expired. Re-import the card.', fraction: null, error: 'upload_missing' }, ctx.userId);
        return;
      }
      deps.log.info(`import_card_from_upload: got ${upload.data.byteLength} bytes, running importCard`);
      try {
        await deps.importAnyFormat(upload.data, msg.fileName || upload.fileName, ctx.userId);
      } finally {
        void deps.deleteUpload(msg.uploadId, ctx.userId).catch(() => {});
      }
    },
    register_svg_raster_index: async (msg, ctx) => {
      const pendingForSvgCheck = deps.pendingImportCompletions.get(msg.characterId);
      if (!pendingForSvgCheck) {
        deps.log.warn(`register_svg_raster_index: no pending import char=${msg.characterId} sender=${ctx.userId},rejecting (late replay or fabrication)`);
        ctx.send({ type: 'error', message: 'register_svg_raster_index: no pending import' }, ctx.userId);
        return;
      }
      if (pendingForSvgCheck.ownerUserId !== ctx.userId) {
        deps.log.warn(`register_svg_raster_index: ownership mismatch char=${msg.characterId} owner=${pendingForSvgCheck.ownerUserId} sender=${ctx.userId}`);
        ctx.send({ type: 'error', message: 'register_svg_raster_index: ownership mismatch' }, ctx.userId);
        return;
      }
      const total = Object.keys(msg.imageIdByMarker).length;
      const successful = Object.values(msg.imageIdByMarker).filter(
        (v) => typeof v === 'string' && v.length > 0,
      ).length;
      const failed = total - successful;
      deps.log.info(
        `register_svg_raster_index: char=${msg.characterId} total=${total} successful=${successful} failed=${failed}`,
      );
      try {
        await deps.applySvgRasterIndex({
          characterId: msg.characterId,
          imageIdByMarker: msg.imageIdByMarker,
          userId: ctx.userId,
        });
      } catch (err) {
        deps.log.warn(`register_svg_raster_index: applySvgRasterIndex failed char=${msg.characterId}: ${deps.errMsg(err)} — finalizing import without SVG raster`);
      }
      pendingForSvgCheck.hasPendingSvgRaster = false;
      deps.log.info(`register_svg_raster_index: cleared svg-pending flag char=${msg.characterId}`);
      await deps.maybeFinalizeImport(msg.characterId);
    },
    delete_card: async (msg, ctx) => {
      const opId = `delete-card-${msg.characterId}-${Date.now()}`;
      let cardName = msg.characterId.slice(0, 8);
      try {
        const c = await deps.characterGet(msg.characterId, ctx.userId);
        if (c?.name) cardName = c.name;
      } catch { /* fall through with id-based label */ }
      const opTitle = `Removing card "${cardName}" from LumiRealm`;
      deps.emitOperationProgress(ctx.userId, opId, 'started', opTitle, 'Clearing extension data…', null);
      try {
        await deps.deleteCardByChar(msg.characterId, ctx.userId, 'soft');
        deps.emitOperationProgress(ctx.userId, opId, 'done', opTitle, 'Removed', 1);
      } catch (err) {
        deps.log.warn(`delete_card: threw char=${msg.characterId}: ${deps.errMsg(err)}`);
        deps.emitOperationProgress(ctx.userId, opId, 'error', opTitle, '', null, deps.errMsg(err));
      }
    },
  };
}
