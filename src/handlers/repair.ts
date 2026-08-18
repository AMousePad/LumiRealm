import type { RepairScanSummary, RepairApplyOptions, RepairApplyResult } from '../types/messages.js';
import type { Handler } from './types.js';

export interface RepairHandlerDeps {
  readonly assetUploadsInFlightRef: { readonly current: number };
  readonly repairInFlightByUser: Set<string>;
  readonly scanRepairTargets: (userId: string) => Promise<RepairScanSummary>;
  readonly applyRepair: (userId: string, options: RepairApplyOptions) => Promise<RepairApplyResult>;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

const EMPTY_REPAIR_SUMMARY: RepairScanSummary = {
  staleModuleRegex: 0, staleCharRegex: 0, deadJournals: 0,
  charactersToRetranslate: 0, modulesToReattach: 0,
  danglingModuleRefs: 0, cardTargets: [], moduleTargets: [], elapsedMs: 0,
};

const EMPTY_REPAIR_RESULT: RepairApplyResult = {
  staleCharRegexDeleted: 0, staleModuleRegexDeleted: 0,
  deadJournalsCleared: 0, charactersRetranslated: 0,
  charactersSkippedLegacy: 0, modulesReattached: 0,
  modulesScrubbed: 0, elapsedMs: 0,
};

export function createRepairHandlers(deps: RepairHandlerDeps): {
  readonly request_repair_scan: Handler<'request_repair_scan'>;
  readonly apply_repair: Handler<'apply_repair'>;
} {
  return {
    request_repair_scan: async (_msg, ctx) => {
      if (deps.assetUploadsInFlightRef.current > 0) {
        ctx.send({
          type: 'repair_scan_result',
          summary: EMPTY_REPAIR_SUMMARY,
          error: 'An import or module upload is in progress. Wait for it to finish, then scan again.',
        }, ctx.userId);
        return;
      }
      try {
        const summary = await deps.scanRepairTargets(ctx.userId);
        deps.log.info(
          `repair-scan: staleModuleRegex=${summary.staleModuleRegex} ` +
            `staleCharRegex=${summary.staleCharRegex} ` +
            `deadJournals=${summary.deadJournals} ` +
            `charsToRetranslate=${summary.charactersToRetranslate} ` +
            `modulesToReattach=${summary.modulesToReattach} ` +
            `danglingModuleRefs=${summary.danglingModuleRefs} ` +
            `elapsed=${summary.elapsedMs}ms`,
        );
        ctx.send({ type: 'repair_scan_result', summary }, ctx.userId);
      } catch (err) {
        deps.log.warn(`repair-scan: failed: ${deps.errMsg(err)}`);
        ctx.send({
          type: 'repair_scan_result',
          summary: EMPTY_REPAIR_SUMMARY,
          error: deps.errMsg(err),
        }, ctx.userId);
      }
    },
    apply_repair: async (msg, ctx) => {
      if (deps.assetUploadsInFlightRef.current > 0) {
        ctx.send({
          type: 'repair_apply_result',
          result: EMPTY_REPAIR_RESULT,
          error: 'An import or module upload is in progress. Wait for it to finish before applying.',
        }, ctx.userId);
        return;
      }
      if (deps.repairInFlightByUser.has(ctx.userId)) {
        ctx.send({
          type: 'repair_apply_result',
          result: EMPTY_REPAIR_RESULT,
          error: 'A repair is already in progress.',
        }, ctx.userId);
        return;
      }
      deps.repairInFlightByUser.add(ctx.userId);
      try {
        const result = await deps.applyRepair(ctx.userId, msg.options);
        deps.log.info(
          `repair-apply: charRegex=${result.staleCharRegexDeleted} ` +
            `moduleRegex=${result.staleModuleRegexDeleted} ` +
            `journals=${result.deadJournalsCleared} ` +
            `retranslated=${result.charactersRetranslated} ` +
            `skippedLegacy=${result.charactersSkippedLegacy} ` +
            `modulesReattached=${result.modulesReattached} ` +
            `modulesScrubbed=${result.modulesScrubbed} ` +
            `elapsed=${result.elapsedMs}ms`,
        );
        ctx.send({ type: 'repair_apply_result', result }, ctx.userId);
      } catch (err) {
        deps.log.warn(`repair-apply: failed: ${deps.errMsg(err)}`);
        ctx.send({
          type: 'repair_apply_result',
          result: EMPTY_REPAIR_RESULT,
          error: deps.errMsg(err),
        }, ctx.userId);
      } finally {
        deps.repairInFlightByUser.delete(ctx.userId);
      }
    },
  };
}
