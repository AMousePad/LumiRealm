import { describe, expect, test } from 'bun:test';

import {
  createOrphanOrchestrator,
  type ImagesListLike,
  type OrphanOrchestratorDeps,
} from './orphan-orchestrator.js';

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

function createScanOrchestrator(
  list: ImagesListLike['list'],
  liveImageId: string | null = 'live',
) {
  const calls: Parameters<ImagesListLike['list']>[0][] = [];
  const warnings: string[] = [];
  const orchestrator = createOrphanOrchestrator({
    imagesApi: {
      list: async (options) => {
        calls.push(options);
        return list(options);
      },
    },
    regexApi: {
      list: async () => ({ data: [], total: 0 }),
      delete: async () => true,
    },
    listLumirealmCharacterIds: async () => [],
    listModuleIds: async () => [],
    characterExists: async () => true,
    moduleExists: async () => true,
    listImageJournalCharacterIds: async () => [],
    readImageJournalFile: async () => null,
    listModuleImageJournalIds: async () => [],
    readModuleImageJournalFile: async () => null,
    clearImageJournal: async () => {},
    clearModuleImageJournal: async () => {},
    buildOrphanDetectDeps: () => ({
      listLumirealmCharacters: async () => liveImageId
        ? [{ id: 'character-1', image_id: liveImageId }]
        : [],
      listModules: async () => [],
      listActiveCharacterJournals: async () => [],
      listActiveModuleJournals: async () => [],
      characterExists: async () => true,
      moduleExists: async () => true,
    }),
    countCharacterRepair: async () => ({
      charactersToRetranslate: 0,
      modulesToReattach: 0,
      danglingModuleRefs: 0,
    }),
    log: { info: () => {}, warn: (message) => warnings.push(message) },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  });
  return { calls, orchestrator, warnings };
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

describe('orphan image scan', () => {
  test('keeps current owned filtering, pagination, deduplication, and newest-first order', async () => {
    const pages = [
      {
        data: [
          { id: 'live', created_at: 9 },
          {
            id: 'old',
            original_filename: 'old.png',
            mime_type: 'image/png',
            width: 10,
            height: 20,
            url: '/old',
            owner_character_id: 'character-2',
            created_at: 1,
          },
        ],
        total: 4,
      },
      {
        data: [
          { id: 'new', created_at: 3 },
          { id: 'old', created_at: 1 },
        ],
        total: 4,
      },
    ];
    const h = createScanOrchestrator(async () => pages.shift()!);

    const report = await h.orchestrator.scanOrphanedImages('user-1');

    expect(h.calls).toEqual([
      { onlyOwned: true, limit: 200, offset: 0, userId: 'user-1' },
      { onlyOwned: true, limit: 200, offset: 2, userId: 'user-1' },
    ]);
    expect(report.orphans).toEqual([
      {
        id: 'new',
        filename: '',
        mime: '',
        width: null,
        height: null,
        url: '',
        ownerCharacterId: null,
        createdAt: 3,
      },
      {
        id: 'old',
        filename: 'old.png',
        mime: 'image/png',
        width: 10,
        height: 20,
        url: '/old',
        ownerCharacterId: 'character-2',
        createdAt: 1,
      },
    ]);
    expect(report.summary).toMatchObject({
      scannedTotal: 3,
      liveCharacterRefs: 1,
      charactersScanned: 1,
      totalOrphans: 2,
      truncated: false,
      orphanRegexCleaned: 0,
    });
    expect(h.warnings).toEqual([]);
  });

  test('stops safely on a malformed response', async () => {
    const h = createScanOrchestrator(
      async () => ({ data: null, total: 1 }) as never,
      null,
    );

    const report = await h.orchestrator.scanOrphanedImages('user-1');

    expect(report.orphans).toEqual([]);
    expect(report.summary.scannedTotal).toBe(0);
    expect(h.warnings).toEqual([
      'scanOrphanedImages: list returned bad shape pages=1, stopping',
    ]);
  });

  test('stops a duplicate-only page without changing collected results', async () => {
    const pages = [
      { data: [{ id: 'old', created_at: 1 }], total: 3 },
      { data: [{ id: 'old', created_at: 1 }], total: 3 },
    ];
    const h = createScanOrchestrator(async () => pages.shift()!, null);

    const report = await h.orchestrator.scanOrphanedImages('user-1');

    expect(report.orphans.map((entry) => entry.id)).toEqual(['old']);
    expect(h.calls.map((options) => options.offset)).toEqual([0, 1]);
    expect(h.warnings).toEqual([
      'scanOrphanedImages: page added 0 new IDs at offset=1 pages=2, stopping (likely host returned dup-only page or ignored offset)',
    ]);
  });

  test('preserves image-list rejection behavior', async () => {
    const h = createScanOrchestrator(async () => {
      throw new Error('list failed');
    });

    await expect(h.orchestrator.scanOrphanedImages('user-1')).rejects.toThrow('list failed');
    expect(h.calls).toEqual([
      { onlyOwned: true, limit: 200, offset: 0, userId: 'user-1' },
    ]);
  });
});
