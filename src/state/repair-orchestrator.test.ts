import { describe, expect, test } from 'bun:test';

import { createRepairOrchestrator, type RepairOrchestratorDeps } from './repair-orchestrator.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';

function repairData(moduleIds: readonly string[]): LumirealmCharacterData {
  return {
    source: {},
    user_overrides: { attached_module_ids: moduleIds },
  } as unknown as LumirealmCharacterData;
}

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

  test('scopes character translation and module refresh independently', async () => {
    const a = repairData(['module-1', 'module-2']);
    const b = repairData(['module-1']);
    const retranslations: string[] = [];
    const refreshed: string[] = [];
    const repair = createRepairOrchestrator({
      listLumirealmCharacters: async () => [
        { character: { id: 'char-a', name: 'A' }, data: a },
        { character: { id: 'char-b', name: 'B' }, data: b },
      ],
      readLumirealm: async (characterId: string) => ({ data: characterId === 'char-a' ? a : b }),
      retranslateCharacter: async (characterId: string) => {
        retranslations.push(characterId);
        return { kind: 'retranslated', data: characterId === 'char-a' ? a : b };
      },
      readModuleEnvelope: async (_userId: string, moduleId: string) => ({ id: moduleId }) as ModuleEnvelope,
      refreshAttachedModule: async (characterId: string, env: ModuleEnvelope) => {
        refreshed.push(`${characterId}:${env.id}`);
      },
      listStaleCharRegexIds: async () => [],
      listStaleModuleRegexIds: async () => [],
      deleteRegexRows: async () => 0,
      clearDeadJournals: async () => 0,
      emitOperationProgress: () => {},
      send: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error: unknown) => String(error),
    } as unknown as RepairOrchestratorDeps);

    const result = await repair.applyRepair('user-1', {
      applyStaleCharRegex: false,
      applyStaleModuleRegex: false,
      applyDeadJournals: false,
      applyForceRetranslate: true,
      characterIds: ['char-a'],
      moduleIds: ['module-1'],
    });

    expect(retranslations).toEqual(['char-a']);
    expect(refreshed).toEqual(['char-a:module-1', 'char-b:module-1']);
    expect(result).toMatchObject({ charactersRetranslated: 1, modulesReattached: 2 });
  });

  test('treats explicit empty target arrays as a no-op', async () => {
    let retranslations = 0;
    let refreshes = 0;
    const repair = createRepairOrchestrator({
      listLumirealmCharacters: async () => [
        { character: { id: 'char-a', name: 'A' }, data: repairData(['module-1']) },
      ],
      retranslateCharacter: async () => {
        retranslations++;
        return { kind: 'failed', error: 'unexpected' };
      },
      refreshAttachedModule: async () => { refreshes++; },
      listStaleCharRegexIds: async () => [],
      listStaleModuleRegexIds: async () => [],
      deleteRegexRows: async () => 0,
      clearDeadJournals: async () => 0,
      emitOperationProgress: () => {},
      send: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error: unknown) => String(error),
    } as unknown as RepairOrchestratorDeps);

    const result = await repair.applyRepair('user-1', {
      applyStaleCharRegex: false,
      applyStaleModuleRegex: false,
      applyDeadJournals: false,
      applyForceRetranslate: true,
      characterIds: [],
      moduleIds: [],
    });

    expect(retranslations).toBe(0);
    expect(refreshes).toBe(0);
    expect(result).toMatchObject({ charactersRetranslated: 0, modulesReattached: 0 });
  });

  test('scrubs only selected missing-module references', async () => {
    let current = repairData(['missing-selected', 'missing-kept']);
    const repair = createRepairOrchestrator({
      listLumirealmCharacters: async () => [
        { character: { id: 'char-a', name: 'A' }, data: current },
      ],
      readLumirealm: async () => ({ data: current }),
      updateLumirealm: async (
        _characterId: string,
        _userId: string,
        update: (data: LumirealmCharacterData) => LumirealmCharacterData,
      ) => {
        current = update(current);
        return current;
      },
      mergeUserOverrides: (
        base: LumirealmCharacterData['user_overrides'],
        patch: Record<string, unknown>,
      ) => ({ ...base, ...patch }) as LumirealmCharacterData['user_overrides'],
      buildDetachModulesPatch: (
        base: LumirealmCharacterData['user_overrides'],
        moduleIds: readonly string[],
      ) => ({
        attached_module_ids: (base.attached_module_ids ?? [])
          .filter((moduleId: string) => !moduleIds.includes(moduleId)),
      }),
      readModuleEnvelope: async () => null,
      listStaleCharRegexIds: async () => [],
      listStaleModuleRegexIds: async () => [],
      deleteRegexRows: async () => 0,
      clearDeadJournals: async () => 0,
      emitOperationProgress: () => {},
      send: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error: unknown) => String(error),
    } as unknown as RepairOrchestratorDeps);

    const result = await repair.applyRepair('user-1', {
      applyStaleCharRegex: false,
      applyStaleModuleRegex: false,
      applyDeadJournals: false,
      applyForceRetranslate: true,
      characterIds: [],
      moduleIds: ['missing-selected'],
    });

    expect(current.user_overrides.attached_module_ids).toEqual(['missing-kept']);
    expect(result).toMatchObject({ modulesScrubbed: 1, modulesReattached: 0 });
  });
});
