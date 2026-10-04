import type { OrphanDetectDeps } from '../state/orphan-detect.js';
import { buildLiveImageIdSet } from '../state/orphan-detect.js';
import type { OrphanScanReport } from '../state/orphan-orchestrator.js';
import type { Handler } from './types.js';

export type OperationPhase = 'started' | 'progress' | 'done' | 'error';

export interface OrphanHandlerDeps {
  readonly assetUploadsInFlightRef: { readonly current: number };
  readonly scanOrphanedImages: (userId: string) => Promise<OrphanScanReport>;
  readonly buildOrphanDetectDeps: (userId: string) => OrphanDetectDeps;
  readonly getImage: (id: string, userId: string) => Promise<{ owner_chat_id: string | null } | null>;
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
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

const EMPTY_SCAN_SUMMARY = {
  scannedTotal: 0, liveCharacterRefs: 0, liveModuleRefs: 0,
  liveJournalRefs: 0, charactersScanned: 0, modulesScanned: 0,
  elapsedMs: 0, totalOrphans: 0, truncated: false,
};

export function createOrphanHandlers(deps: OrphanHandlerDeps): {
  readonly request_orphan_scan: Handler<'request_orphan_scan'>;
  readonly delete_orphan_assets: Handler<'delete_orphan_assets'>;
} {
  return {
    request_orphan_scan: async (_msg, ctx) => {
      if (deps.assetUploadsInFlightRef.current > 0) {
        ctx.send({
          type: 'orphan_scan_result',
          orphans: [],
          summary: EMPTY_SCAN_SUMMARY,
          error: 'An import or module upload is in progress. Wait for it to finish, then scan again.',
        }, ctx.userId);
        return;
      }
      ctx.send({ type: 'orphan_scan_started' }, ctx.userId);
      try {
        const report = await deps.scanOrphanedImages(ctx.userId);
        deps.log.info(
          `orphan-scan: owned=${report.summary.scannedTotal} ` +
            `live(char=${report.summary.liveCharacterRefs} ` +
            `module=${report.summary.liveModuleRefs} ` +
            `journal=${report.summary.liveJournalRefs}) ` +
            `chars=${report.summary.charactersScanned} ` +
            `modules=${report.summary.modulesScanned} ` +
            `orphans=${report.summary.totalOrphans}${report.summary.truncated ? `(shown=${report.orphans.length})` : ''} ` +
            `elapsed=${report.summary.elapsedMs}ms`,
        );
        ctx.send({
          type: 'orphan_scan_result',
          orphans: report.orphans,
          summary: report.summary,
        }, ctx.userId);
      } catch (err) {
        deps.log.warn(`orphan-scan: failed: ${deps.errMsg(err)}`);
        ctx.send({
          type: 'orphan_scan_result',
          orphans: [],
          summary: { ...EMPTY_SCAN_SUMMARY, orphanRegexCleaned: 0 },
          error: deps.errMsg(err),
        }, ctx.userId);
      }
    },
    delete_orphan_assets: async (msg, ctx) => {
      const requested = msg.imageIds.length;
      if (deps.assetUploadsInFlightRef.current > 0) {
        ctx.send({
          type: 'orphan_delete_result',
          requested, deleted: 0, absent: 0, failed: 0, skipped: 0,
          skippedIds: [],
          error: 'An import or module upload is in progress. Wait for it to finish before deleting.',
        }, ctx.userId);
        return;
      }
      if (requested === 0) {
        ctx.send({
          type: 'orphan_delete_result',
          requested: 0, deleted: 0, absent: 0, failed: 0, skipped: 0,
          skippedIds: [],
        }, ctx.userId);
        return;
      }
      const opId = `delete-orphans-${Date.now()}`;
      const opTitle = `Deleting ${requested} orphan asset${requested === 1 ? '' : 's'}`;
      deps.emitOperationProgress(ctx.userId, opId, 'started', opTitle, 'Verifying live references…', null);
      try {
        // Re-verify against the live set immediately before deletion. An
        // import or asset-add finishing between scan and delete would have
        // committed new IDs to live storage, those must not be deleted.
        const live = await buildLiveImageIdSet(deps.buildOrphanDetectDeps(ctx.userId));
        const safeIds: string[] = [];
        const skippedIds: string[] = [];
        for (const id of msg.imageIds) {
          if (typeof id !== 'string' || id.length === 0) continue;
          if (live.liveIds.has(id) || (await deps.getImage(id, ctx.userId))?.owner_chat_id) {
            skippedIds.push(id);
            continue;
          }
          safeIds.push(id);
        }
        if (skippedIds.length > 0) {
          deps.log.warn(
            `orphan-cleanup: ${skippedIds.length} ID(s) became live between scan and delete, skipping`,
          );
        }
        if (safeIds.length === 0) {
          deps.emitOperationProgress(
            ctx.userId, opId, 'done', opTitle,
            `Nothing to delete (${skippedIds.length} skipped,became live)`,
            1,
          );
        } else {
          deps.emitOperationProgress(
            ctx.userId, opId, 'progress', opTitle,
            `Deleting 0 of ${safeIds.length}…`,
            0,
          );
        }
        const stats = safeIds.length > 0
          ? await deps.deleteImageIds(
              safeIds, ctx.userId, 'orphan-cleanup',
              (processed, total) => {
                deps.emitOperationProgress(
                  ctx.userId, opId, 'progress', opTitle,
                  `Deleting ${processed} of ${total}…`,
                  total > 0 ? processed / total : null,
                );
              },
            )
          : { deleted: 0, absent: 0, failed: 0 };
        deps.log.info(
          `orphan-cleanup: requested=${requested} deleted=${stats.deleted} ` +
            `absent=${stats.absent} failed=${stats.failed} skipped=${skippedIds.length}`,
        );
        if (safeIds.length > 0) {
          const tail = stats.failed > 0
            ? ` (${stats.failed} failed)`
            : stats.absent > 0
              ? ` (${stats.absent} already gone)`
              : '';
          deps.emitOperationProgress(
            ctx.userId, opId, 'done', opTitle,
            `Deleted ${stats.deleted} of ${safeIds.length}${tail}`,
            1,
          );
        }
        ctx.send({
          type: 'orphan_delete_result',
          requested,
          deleted: stats.deleted,
          absent: stats.absent,
          failed: stats.failed,
          skipped: skippedIds.length,
          skippedIds,
        }, ctx.userId);
      } catch (err) {
        deps.log.warn(`orphan-cleanup: threw: ${deps.errMsg(err)}`);
        deps.emitOperationProgress(ctx.userId, opId, 'error', opTitle, '', null, deps.errMsg(err));
        ctx.send({
          type: 'orphan_delete_result',
          requested, deleted: 0, absent: 0, failed: requested, skipped: 0,
          skippedIds: [],
          error: deps.errMsg(err),
        }, ctx.userId);
      }
    },
  };
}
