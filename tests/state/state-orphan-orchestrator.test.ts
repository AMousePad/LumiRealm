import { describe, test, expect } from 'bun:test';
import {
  createOrphanOrchestrator,
  type OrphanOrchestratorDeps,
  type SpindleImageDTOLike,
  type JournalFileLike,
  type RegexScriptsApiLike,
} from '../../src/state/orphan-orchestrator.js';
import type { OrphanDetectDeps } from '../../src/state/orphan-detect.js';
import type { RegexScriptDTO } from 'lumiverse-spindle-types';

interface MockState {
  warns: string[];
  infos: string[];
  imageListCalls: Array<{ offset: number; limit: number }>;
  regexListCalls: Array<{ offset: number }>;
  regexDeleteCalls: string[];
  clearedCharJournals: string[];
  clearedModuleJournals: string[];
}

function emptyOrphanDetectDeps(): OrphanDetectDeps {
  return {
    listLumirealmCharacters: async () => [],
    listModules: async () => [],
    listActiveCharacterJournals: async () => [],
    listActiveModuleJournals: async () => [],
    characterExists: async () => true,
    moduleExists: async () => true,
  };
}

function makeMockDeps(overrides: {
  imagePages?: Array<{ data: SpindleImageDTOLike[]; total?: number }>;
  liveImageIds?: readonly string[];
  regexPages?: Array<{ data: unknown[]; total?: number }>;
  regexNoApi?: boolean;
  charJournalIds?: readonly string[];
  charJournalFiles?: Record<string, JournalFileLike | null>;
  moduleJournalIds?: readonly string[];
  moduleJournalFiles?: Record<string, JournalFileLike | null>;
  characterExists?: (uid: string, id: string) => Promise<boolean>;
  moduleExists?: (uid: string, id: string) => Promise<boolean>;
  listLumirealmCharacterIds?: (uid: string) => Promise<readonly string[]>;
  listModuleIds?: (uid: string) => Promise<readonly string[]>;
  countCharacterRepair?: OrphanOrchestratorDeps['countCharacterRepair'];
  buildOrphanDetectDeps?: OrphanOrchestratorDeps['buildOrphanDetectDeps'];
} = {}): { deps: OrphanOrchestratorDeps; state: MockState } {
  const state: MockState = {
    warns: [],
    infos: [],
    imageListCalls: [],
    regexListCalls: [],
    regexDeleteCalls: [],
    clearedCharJournals: [],
    clearedModuleJournals: [],
  };
  const imagePages = overrides.imagePages ?? [];
  const regexPages = overrides.regexPages ?? [];
  const charJournals = overrides.charJournalFiles ?? {};
  const moduleJournals = overrides.moduleJournalFiles ?? {};

  const deps: OrphanOrchestratorDeps = {
    imagesApi: {
      list: async (opts) => {
        state.imageListCalls.push({ offset: opts.offset ?? 0, limit: opts.limit ?? 0 });
        const idx = state.imageListCalls.length - 1;
        const page = imagePages[idx] ?? { data: [], total: 0 };
        return { data: page.data, total: page.total ?? page.data.length };
      },
    },
    regexApi: overrides.regexNoApi ? (null as unknown as RegexScriptsApiLike) : {
      list: async (opts) => {
        state.regexListCalls.push({ offset: opts?.offset ?? 0 });
        const idx = state.regexListCalls.length - 1;
        const page = regexPages[idx] ?? { data: [], total: 0 };
        return { data: page.data as RegexScriptDTO[], total: page.total ?? page.data.length };
      },
      delete: async (id) => {
        state.regexDeleteCalls.push(id);
        return true;
      },
    },
    listLumirealmCharacterIds: overrides.listLumirealmCharacterIds ?? (async () => []),
    listModuleIds: overrides.listModuleIds ?? (async () => []),
    characterExists: overrides.characterExists ?? (async () => true),
    moduleExists: overrides.moduleExists ?? (async () => true),
    listImageJournalCharacterIds: async () => overrides.charJournalIds ?? [],
    readImageJournalFile: async (_uid, charId) => charJournals[charId] ?? null,
    listModuleImageJournalIds: async () => overrides.moduleJournalIds ?? [],
    readModuleImageJournalFile: async (_uid, modId) => moduleJournals[modId] ?? null,
    clearImageJournal: async (_uid, charId) => { state.clearedCharJournals.push(charId); },
    clearModuleImageJournal: async (_uid, modId) => { state.clearedModuleJournals.push(modId); },
    buildOrphanDetectDeps: overrides.buildOrphanDetectDeps ?? (() => {
      const odd = emptyOrphanDetectDeps();
      const liveIds = overrides.liveImageIds ?? [];
      return {
        ...odd,
        listLumirealmCharacters: async () => liveIds.map((id, i) => ({
          id: `c-${i}`,
          image_id: id,
          asset_index: {},
          emotion_index: {},
          regex_replace_strings: [],
          background_html: null,
        })),
      };
    }),
    countCharacterRepair: overrides.countCharacterRepair ?? (async () => ({
      charactersToRetranslate: 0,
      modulesToReattach: 0,
      danglingModuleRefs: 0,
      cardTargets: [],
      moduleTargets: [],
    })),
    log: {
      info: (m) => state.infos.push(m),
      warn: (m) => state.warns.push(m),
    },
    errMsg: (e) => (e instanceof Error ? e.message : String(e)),
  };
  return { deps, state };
}

describe('createOrphanOrchestrator: detectDeletedWhileOff', () => {
  test('character whose journal exists but get returns false → flagged', async () => {
    const { deps } = makeMockDeps({
      charJournalIds: ['c-dead'],
      charJournalFiles: { 'c-dead': { status: 'active', imageIds: ['i1'] } },
      characterExists: async (_uid, id) => id !== 'c-dead',
    });
    const o = createOrphanOrchestrator(deps);
    const result = await o.detectDeletedWhileOff('u-1');
    expect(result.characterIds).toEqual(['c-dead']);
    expect(result.moduleIds).toEqual([]);
  });

  test('module whose envelope is gone → flagged', async () => {
    const { deps } = makeMockDeps({
      moduleJournalIds: ['m-dead'],
      moduleJournalFiles: { 'm-dead': { status: 'active', imageIds: ['i1'] } },
      moduleExists: async (_uid, id) => id !== 'm-dead',
    });
    const o = createOrphanOrchestrator(deps);
    const result = await o.detectDeletedWhileOff('u-1');
    expect(result.characterIds).toEqual([]);
    expect(result.moduleIds).toEqual(['m-dead']);
  });

  test('characters.get throws → skipped (not flagged), warn logged', async () => {
    const { deps, state } = makeMockDeps({
      charJournalIds: ['c-1'],
      charJournalFiles: { 'c-1': { status: 'active', imageIds: [] } },
      characterExists: async () => { throw new Error('net'); },
    });
    const o = createOrphanOrchestrator(deps);
    const result = await o.detectDeletedWhileOff('u-1');
    expect(result.characterIds).toEqual([]);
    expect(state.warns.some((w) => w.includes('characters.get'))).toBe(true);
  });

  test('journal file null → skipped', async () => {
    const { deps } = makeMockDeps({
      charJournalIds: ['c-1'],
      charJournalFiles: { 'c-1': null },
    });
    const o = createOrphanOrchestrator(deps);
    const result = await o.detectDeletedWhileOff('u-1');
    expect(result.characterIds).toEqual([]);
  });
});

describe('createOrphanOrchestrator: scanOrphanedImages', () => {
  test('paginates by 200, stops on empty page', async () => {
    const { deps, state } = makeMockDeps({
      imagePages: [
        { data: [{ id: 'a' } as SpindleImageDTOLike], total: 2 },
        { data: [{ id: 'b' } as SpindleImageDTOLike], total: 2 },
        { data: [], total: 2 },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    const r = await o.scanOrphanedImages('u-1');
    expect(state.imageListCalls).toHaveLength(2);
    expect(r.summary.scannedTotal).toBe(2);
  });

  test('zero-new-IDs runaway-loop guard kicks in (host ignores offset)', async () => {
    const { deps, state } = makeMockDeps({
      imagePages: [
        { data: [{ id: 'a' } as SpindleImageDTOLike], total: 100 },
        { data: [{ id: 'a' } as SpindleImageDTOLike], total: 100 },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    await o.scanOrphanedImages('u-1');
    expect(state.warns.some((w) => w.includes('page added 0 new IDs'))).toBe(true);
    expect(state.imageListCalls.length).toBeLessThanOrEqual(2);
  });

  test('live-set filter excludes referenced images', async () => {
    const { deps } = makeMockDeps({
      imagePages: [
        { data: [{ id: 'live-1' } as SpindleImageDTOLike, { id: 'orphan-1' } as SpindleImageDTOLike], total: 2 },
      ],
      liveImageIds: ['live-1'],
    });
    const o = createOrphanOrchestrator(deps);
    const r = await o.scanOrphanedImages('u-1');
    expect(r.orphans.map((o) => o.id)).toEqual(['orphan-1']);
  });

  test('orphans sorted by createdAt desc', async () => {
    const { deps } = makeMockDeps({
      imagePages: [
        {
          data: [
            { id: 'old', created_at: 1000 } as SpindleImageDTOLike,
            { id: 'new', created_at: 9000 } as SpindleImageDTOLike,
          ],
          total: 2,
        },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    const r = await o.scanOrphanedImages('u-1');
    expect(r.orphans.map((o) => o.id)).toEqual(['new', 'old']);
  });
});

describe('createOrphanOrchestrator: sweepOrphanModuleRegex', () => {
  test('returns 0 when regexApi unavailable', async () => {
    const { deps } = makeMockDeps({ regexNoApi: true });
    const o = createOrphanOrchestrator(deps);
    expect(await o.sweepOrphanModuleRegex('u-1')).toBe(0);
  });

  test('deletes only rows with module_id pointing to dead module', async () => {
    const { deps, state } = makeMockDeps({
      listModuleIds: async () => ['m-live'],
      regexPages: [
        {
          data: [
            { id: 'r-1', metadata: { _risu: { module_id: 'm-dead' } } },
            { id: 'r-2', metadata: { _risu: { module_id: 'm-live' } } },
            { id: 'r-3', metadata: {} }, // not module-owned, skip
          ],
          total: 3,
        },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    const deleted = await o.sweepOrphanModuleRegex('u-1');
    expect(deleted).toBe(1);
    expect(state.regexDeleteCalls).toEqual(['r-1']);
  });

  test('empty result when no dead modules referenced', async () => {
    const { deps, state } = makeMockDeps({
      listModuleIds: async () => ['m-live'],
      regexPages: [
        { data: [{ id: 'r-1', metadata: { _risu: { module_id: 'm-live' } } }], total: 1 },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    expect(await o.sweepOrphanModuleRegex('u-1')).toBe(0);
    expect(state.regexDeleteCalls).toEqual([]);
  });
});

describe('createOrphanOrchestrator: listStaleCharRegexIds', () => {
  test('character-scope rows with LumiRealm origin, no module_id, owned by dead char → orphan', async () => {
    const { deps } = makeMockDeps({
      listLumirealmCharacterIds: async () => ['c-live'],
      regexPages: [
        {
          data: [
            { id: 'r-1', scope: 'character', scope_id: 'c-dead', metadata: { _risu: { origin: 'character' } } },
            { id: 'r-2', scope: 'character', scope_id: 'c-live', metadata: { _risu: { origin: 'character' } } },
            { id: 'r-3', scope: 'global', scope_id: null, metadata: { _risu: { origin: 'character' } } },
            { id: 'r-4', scope: 'character', scope_id: 'c-dead', metadata: { _risu: { module_id: 'm-1', origin: 'module' } } },
            { id: 'r-5', scope: 'character', scope_id: 'c-dead', metadata: { _risu: {} } },
          ],
          total: 5,
        },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    const stale = await o.listStaleCharRegexIds('u-1');
    expect(stale).toEqual(['r-1']);
  });

  test('returns [] when regexApi unavailable', async () => {
    const { deps } = makeMockDeps({ regexNoApi: true });
    const o = createOrphanOrchestrator(deps);
    expect(await o.listStaleCharRegexIds('u-1')).toEqual([]);
  });
});

describe('createOrphanOrchestrator: deleteRegexIds', () => {
  test('counts successful deletes, warns on throws', async () => {
    let call = 0;
    const warns: string[] = [];
    const baseDeps = makeMockDeps().deps;
    const deps: OrphanOrchestratorDeps = {
      ...baseDeps,
      regexApi: {
        ...baseDeps.regexApi!,
        delete: async (id: string) => {
          call++;
          if (id === 'bad') throw new Error('boom');
          return true;
        },
      },
      log: { info: () => undefined, warn: (m) => warns.push(m) },
    };
    const o = createOrphanOrchestrator(deps);
    const deleted = await o.deleteRegexIds('u-1', ['ok-1', 'bad', 'ok-2']);
    expect(deleted).toBe(2);
    expect(call).toBe(3);
    expect(warns.some((w) => w.includes('id=bad'))).toBe(true);
  });
});

describe('createOrphanOrchestrator: clearDeadJournals', () => {
  test('clears journals for both deleted chars and modules', async () => {
    const { deps, state } = makeMockDeps({
      charJournalIds: ['c-dead'],
      charJournalFiles: { 'c-dead': { status: 'active', imageIds: [] } },
      characterExists: async () => false,
      moduleJournalIds: ['m-dead'],
      moduleJournalFiles: { 'm-dead': { status: 'active', imageIds: [] } },
      moduleExists: async () => false,
    });
    const o = createOrphanOrchestrator(deps);
    const cleared = await o.clearDeadJournals('u-1');
    expect(cleared).toBe(2);
    expect(state.clearedCharJournals).toEqual(['c-dead']);
    expect(state.clearedModuleJournals).toEqual(['m-dead']);
  });
});

describe('createOrphanOrchestrator: scanRepairTargets', () => {
  test('threads countCharacterRepair into result', async () => {
    const { deps } = makeMockDeps({
      countCharacterRepair: async () => ({
        charactersToRetranslate: 5,
        modulesToReattach: 3,
        danglingModuleRefs: 2,
        cardTargets: [{
          characterId: 'char-1',
          characterName: 'Card',
          canRetranslate: true,
          attachedModuleCount: 1,
        }],
        moduleTargets: [{
          moduleId: 'module-1',
          moduleName: 'Module',
          missing: false,
          attachmentCount: 1,
        }],
      }),
    });
    const o = createOrphanOrchestrator(deps);
    const summary = await o.scanRepairTargets('u-1');
    expect(summary.charactersToRetranslate).toBe(5);
    expect(summary.modulesToReattach).toBe(3);
    expect(summary.danglingModuleRefs).toBe(2);
    expect(summary.cardTargets).toHaveLength(1);
    expect(summary.moduleTargets).toHaveLength(1);
  });

  test('counts stale module regex from regex pages', async () => {
    const { deps } = makeMockDeps({
      listModuleIds: async () => ['m-live'],
      regexPages: [
        {
          data: [
            { id: 'r-1', metadata: { _risu: { module_id: 'm-dead-1' } } },
            { id: 'r-2', metadata: { _risu: { module_id: 'm-live' } } },
            { id: 'r-3', metadata: { _risu: { module_id: 'm-dead-2' } } },
          ],
          total: 3,
        },
      ],
    });
    const o = createOrphanOrchestrator(deps);
    const summary = await o.scanRepairTargets('u-1');
    expect(summary.staleModuleRegex).toBe(2);
  });

  test('countCharacterRepair throws → warn + zeros', async () => {
    const { deps, state } = makeMockDeps({
      countCharacterRepair: async () => { throw new Error('count fail'); },
    });
    const o = createOrphanOrchestrator(deps);
    const summary = await o.scanRepairTargets('u-1');
    expect(summary.charactersToRetranslate).toBe(0);
    expect(state.warns.some((w) => w.includes('char/module count failed'))).toBe(true);
  });
});
