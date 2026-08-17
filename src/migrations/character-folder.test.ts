import { describe, expect, test } from 'bun:test';

import { translateFromStoredSource } from '../core/pipeline/translate.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import { CHARACTER_MIGRATIONS, type MigrationDeps } from './character.js';

describe('character regex folder migration', () => {
  test('corrects only the old generated card-sidecar label', async () => {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Ada' } };
    const module = {
      id: 'sidecar',
      name: 'Ada Rules',
      description: '',
      regex: [{ comment: 'Card rule', in: 'x', out: 'y', type: 'editdisplay', flag: 'g', ableFlag: true }],
    };
    const newBundle = translateFromStoredSource({ card, module });
    const patches: Array<Record<string, unknown> | null> = [];
    const step = CHARACTER_MIGRATIONS.find((candidate) => candidate.version === 22)!;
    const envelope = { source: { card, module } } as unknown as LumirealmCharacterData;
    const deps = {
      applyCharacterRegexRowPatch: async (
        _characterId: string,
        _userId: string,
        patch: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
      ) => {
        patches.push(patch({ folder: 'Module — Ada Rules', metadata: { _risu: { origin: 'module' } } }));
        patches.push(patch({ folder: 'CardX — Ada', metadata: { _risu: { origin: 'character' } } }));
        patches.push(patch({ folder: 'My Folder', metadata: { _risu: { origin: 'module' } } }));
        patches.push(patch({ folder: 'Module — Ada Rules', metadata: { _risu: { origin: 'module', module_id: 'real-module' } } }));
        patches.push(patch({ folder: 'Module — Ada Rules', metadata: { _risu: { origin: 'module', imported_regex: true } } }));
        return { scanned: 5, updated: 2, failed: 0 };
      },
    } as unknown as MigrationDeps;

    await step.apply(
      { envelope, characterId: 'char-1', characterName: 'Ada', userId: 'user-1', newBundle },
      deps,
    );

    expect(patches).toEqual([{ folder: 'CharX — Ada' }, { folder: 'CharX — Ada' }, null, null, null]);
  });

  test('repairs the spelling if v22 already ran', async () => {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Ada' } };
    const newBundle = translateFromStoredSource({ card, module: null });
    const patches: Array<Record<string, unknown> | null> = [];
    const step = CHARACTER_MIGRATIONS.find((candidate) => candidate.version === 23)!;
    const envelope = { source: { card, module: null } } as unknown as LumirealmCharacterData;
    const deps = {
      applyCharacterRegexRowPatch: async (
        _characterId: string,
        _userId: string,
        patch: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
      ) => {
        patches.push(patch({ folder: 'CardX — Ada', metadata: { _risu: { origin: 'module' } } }));
        patches.push(patch({ folder: 'My Folder', metadata: { _risu: { origin: 'character' } } }));
        return { scanned: 2, updated: 1, failed: 0 };
      },
    } as unknown as MigrationDeps;

    await step.apply(
      { envelope, characterId: 'char-1', characterName: 'Ada', userId: 'user-1', newBundle },
      deps,
    );

    expect(patches).toEqual([{ folder: 'CharX — Ada' }, null]);
  });
});
