import { describe, expect, test } from 'bun:test';

import { createOrphanOrchestrator, type OrphanOrchestratorDeps } from './orphan-orchestrator.js';

function createOrchestrator(rows: readonly unknown[]) {
  return createOrphanOrchestrator({
    regexApi: {
      list: async () => ({ data: rows, total: rows.length }),
    },
    listLumirealmCharacterIds: async () => ['live-character'],
    listModuleIds: async () => ['live-module'],
    log: { info: () => {}, warn: () => {} },
    errMsg: (error: unknown) => String(error),
  } as unknown as OrphanOrchestratorDeps);
}

describe('stale regex detection', () => {
  test('selects only LumiRealm character rows whose owner is gone', async () => {
    const orchestrator = createOrchestrator([
      { id: 'stale', scope: 'character', scope_id: 'gone', metadata: { _risu: { origin: 'character' } } },
      { id: 'live', scope: 'character', scope_id: 'live-character', metadata: { _risu: { origin: 'module' } } },
      { id: 'unknown', scope: 'character', scope_id: 'gone', metadata: { _risu: {} } },
      { id: 'module-row', scope: 'character', scope_id: 'gone', metadata: { _risu: { module_id: 'gone-module', origin: 'module' } } },
    ]);

    await expect(orchestrator.listStaleCharRegexIds('user-1')).resolves.toEqual(['stale']);
  });

  test('selects module rows whose module is gone', async () => {
    const orchestrator = createOrchestrator([
      { id: 'stale', metadata: { _risu: { module_id: 'gone-module', source_row_index: 0 } } },
      { id: 'live', metadata: { _risu: { module_id: 'live-module', source_row_index: 0 } } },
      { id: 'unknown', metadata: { _risu: { module_id: 'gone-module' } } },
    ]);

    await expect(orchestrator.listStaleModuleRegexIds('user-1')).resolves.toEqual(['stale']);
  });
});
