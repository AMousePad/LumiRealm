import { describe, expect, test } from 'bun:test';

import { createRepairOrchestrator, type RepairOrchestratorDeps } from './repair-orchestrator.js';

describe('repair regex cleanup', () => {
  test('deletes validated stale character and module rows through the supplied deleter', async () => {
    const deleted: string[][] = [];
    const repair = createRepairOrchestrator({
      listStaleCharRegexIds: async () => ['char-row'],
      listStaleModuleRegexIds: async () => ['module-row'],
      deleteRegexRows: async (_userId: string, ids: readonly string[]) => {
        deleted.push([...ids]);
        return ids.length;
      },
      clearDeadJournals: async () => 0,
      emitOperationProgress: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error: unknown) => String(error),
    } as unknown as RepairOrchestratorDeps);

    const result = await repair.applyRepair('user-1', {
      applyStaleCharRegex: true,
      applyStaleModuleRegex: true,
      applyDeadJournals: false,
      applyForceRetranslate: false,
    });

    expect(deleted).toEqual([['char-row'], ['module-row']]);
    expect(result).toMatchObject({
      staleCharRegexDeleted: 1,
      staleModuleRegexDeleted: 1,
    });
  });
});
