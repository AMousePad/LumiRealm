import { describe, expect, test } from 'bun:test';
import type { LumirealmCharacterData } from '../payload/types.js';
import { buildRepairTargetSummary } from './repair-targets.js';

function data(source: boolean, moduleIds: readonly string[]): LumirealmCharacterData {
  return {
    ...(source ? { source: {} } : {}),
    user_overrides: { attached_module_ids: moduleIds },
  } as unknown as LumirealmCharacterData;
}

describe('repair target summary', () => {
  test('builds searchable card/module targets and counts attachment pairs once', () => {
    const summary = buildRepairTargetSummary([
      { character: { id: 'char-b', name: 'Beta' }, data: data(true, ['module-1', 'missing']) },
      { character: { id: 'char-a', name: 'Alpha' }, data: data(false, ['module-1']) },
      { character: { id: 'native', name: 'Native' }, data: null },
    ], [
      { id: 'module-1', name: 'Shared module' },
      { id: 'unused', name: 'Unused module' },
    ]);

    expect(summary).toEqual({
      charactersToRetranslate: 1,
      modulesToReattach: 2,
      danglingModuleRefs: 1,
      cardTargets: [
        {
          characterId: 'char-a',
          characterName: 'Alpha',
          canRetranslate: false,
          attachedModuleCount: 1,
        },
        {
          characterId: 'char-b',
          characterName: 'Beta',
          canRetranslate: true,
          attachedModuleCount: 2,
        },
      ],
      moduleTargets: [
        {
          moduleId: 'module-1',
          moduleName: 'Shared module',
          missing: false,
          attachmentCount: 2,
        },
        {
          moduleId: 'missing',
          moduleName: null,
          missing: true,
          attachmentCount: 1,
        },
      ],
    });
  });
});
