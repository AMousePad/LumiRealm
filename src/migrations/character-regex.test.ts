import { describe, expect, test } from 'bun:test';

import { translateFromStoredSource } from '../core/pipeline/translate.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import { CHARACTER_MIGRATIONS, type MigrationDeps } from './character.js';

const sourceScript = {
  comment: 'Rule',
  in: 'x',
  out: 'y',
  type: 'editdisplay',
  flag: 'g',
  ableFlag: true,
};
const card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Ada',
    extensions: { risuai: { customScripts: [sourceScript] } },
  },
};
const module = { id: 'sidecar', name: 'Ada Rules', description: '', regex: [sourceScript] };
const newBundle = translateFromStoredSource({ card, module });
const envelope = {
  source: { card, module },
  payload: newBundle.risuPayload,
  regex_scripts: [],
} as unknown as LumirealmCharacterData;
const args = {
  envelope,
  characterId: 'char-1',
  characterName: 'Ada',
  userId: 'user-1',
  newBundle,
};

function step(version: number) {
  return CHARACTER_MIGRATIONS.find((candidate) => candidate.version === version)!;
}

function makeDeps(overrides: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    installCharacterRegexScripts: async () => {},
    reinstallAttachedModules: async () => 0,
    dispatchSvgRasterize: () => {},
    writeEnvelope: async () => {},
    getAvatarImageId: async () => null,
    getCharacterWorldBookIds: async () => [],
    listWorldBookEntries: async () => [],
    updateWorldBookEntryExtensions: async () => {},
    updateWorldBookEntryActivation: async () => {},
    applyCharacterRegexReplaceStringTransform: async () => ({ scanned: 0, updated: 0, failed: 0 }),
    applyCharacterRegexRowPatch: async () => ({ scanned: 0, updated: 0, failed: 0 }),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    extensionVersion: 'test',
    ...overrides,
  };
}

describe('character regex migration dependencies', () => {
  test('v9 applies the style transform in place', async () => {
    let transformed = '';
    let installs = 0;
    const result = await step(9).apply(args, makeDeps({
      installCharacterRegexScripts: async () => { installs++; },
      applyCharacterRegexReplaceStringTransform: async (characterId, userId, transform) => {
        expect([characterId, userId]).toEqual(['char-1', 'user-1']);
        transformed = transform('<style>.x-risu-card{color:red}</style><div class="x-risu-card">');
        return { scanned: 2, updated: 1, failed: 0 };
      },
    }));

    expect(transformed).toContain('<style>.card');
    expect(transformed).toContain('class="x-risu-card"');
    expect(result.notes).toEqual(['scanned=2', 'updated=1', 'failed=0']);
    expect(installs).toBe(0);
  });

  test('v11 keeps the phase-specific row patches', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(11).apply(args, makeDeps({
      applyCharacterRegexRowPatch: async (_characterId, _userId, patch) => {
        patches.push(patch({ metadata: { _risu: { phase: 'editprocess' } }, placement: ['world_info', 'ai_output'] }));
        patches.push(patch({ metadata: { _risu: { phase: 'edittrans' } }, target: 'prompt' }));
        patches.push(patch({ metadata: { _risu: { phase: 'editdisplay' } } }));
        return { scanned: 3, updated: 2, failed: 0 };
      },
    }));

    expect(patches).toEqual([
      { placement: ['ai_output'] },
      { disabled: true, target: 'display', placement: ['ai_output', 'user_input'] },
      null,
    ]);
  });

  test('v12 reinstalls only for the historical zero-row recovery case', async () => {
    const installs: number[] = [];
    const missing = await step(12).apply(args, makeDeps({
      installCharacterRegexScripts: async (_id, _name, scripts) => { installs.push(scripts.length); },
      applyCharacterRegexReplaceStringTransform: async (_id, _userId, transform) => {
        expect(transform('unchanged')).toBe('unchanged');
        return { scanned: 0, updated: 0, failed: 0 };
      },
    }));
    const present = await step(12).apply(args, makeDeps({
      installCharacterRegexScripts: async (_id, _name, scripts) => { installs.push(scripts.length); },
      applyCharacterRegexReplaceStringTransform: async () => ({ scanned: 2, updated: 0, failed: 0 }),
    }));

    expect(installs).toEqual([newBundle.regexScripts.length]);
    expect(missing.notes[0]).toBe('empty-rowset recovery');
    expect(missing.nextEnvelope.regex_scripts).toHaveLength(newBundle.regexScripts.length);
    expect(present.notes).toEqual(['rows present (scanned=2), reinstall skipped']);
    expect(present.nextEnvelope).toBe(envelope);
  });

  test('v13 reroutes only escaped per-message rows', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(13).apply(args, makeDeps({
      applyCharacterRegexRowPatch: async (_characterId, _userId, patch) => {
        patches.push(patch({ substitute_macros: 'escaped', replace_string: '{{chat_index}}' }));
        patches.push(patch({ substitute_macros: 'escaped', replace_string: '{{user}}' }));
        patches.push(patch({ substitute_macros: 'none', replace_string: '{{chat_index}}' }));
        return { scanned: 3, updated: 1, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ substitute_macros: 'after' }, null, null]);
  });

  test('v17 moves only CBS-action rows to find mode', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(17).apply(args, makeDeps({
      applyCharacterRegexRowPatch: async (_characterId, _userId, patch) => {
        patches.push(patch({ substitute_macros: 'none', metadata: { _risu: { flag_actions: ['cbs'] } } }));
        patches.push(patch({ substitute_macros: 'none', metadata: { _risu: { flag_actions: ['move'] } } }));
        patches.push(patch({ substitute_macros: 'after', metadata: { _risu: { flag_actions: ['cbs'] } } }));
        return { scanned: 3, updated: 1, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ substitute_macros: 'find' }, null, null]);
  });

  test('v21 fills only empty generated folders', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(21).apply(args, makeDeps({
      applyCharacterRegexRowPatch: async (_characterId, _userId, patch) => {
        patches.push(patch({ folder: '', metadata: { _risu: { origin: 'character' } } }));
        patches.push(patch({ folder: '', metadata: { _risu: { origin: 'module' } } }));
        patches.push(patch({ folder: 'Custom', metadata: { _risu: { origin: 'character' } } }));
        return { scanned: 3, updated: 2, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ folder: 'CharX — Ada' }, { folder: 'CharX — Ada' }, null]);
  });

  test('v21-v23 still reject failed row updates', async () => {
    for (const version of [21, 22, 23]) {
      await expect(step(version).apply(args, makeDeps({
        applyCharacterRegexRowPatch: async () => ({ scanned: 1, updated: 0, failed: 1 }),
      }))).rejects.toThrow('did not complete');
    }
  });
});
