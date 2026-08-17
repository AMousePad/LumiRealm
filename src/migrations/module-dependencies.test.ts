import { describe, expect, test } from 'bun:test';

import type { ModuleEnvelope } from '../state/modules-store.js';
import {
  CURRENT_MODULE_SCHEMA_VERSION,
  MODULE_MIGRATIONS,
  type ModuleMigrationDeps,
} from './module.js';

const env = {
  schema_version: 1,
  id: 'module-1',
  filename: 'module.risum',
  uploaded_at: 1,
  module: { id: 'module-1', name: 'Module' },
  asset_index: {},
} as unknown as ModuleEnvelope;
const args = { env };

function step(version: number) {
  return MODULE_MIGRATIONS.find((candidate) => candidate.version === version)!;
}

function makeDeps(overrides: Partial<ModuleMigrationDeps> = {}): ModuleMigrationDeps {
  return {
    syncWorldBook: async () => null,
    reinstallArtifactsForAttached: async () => 0,
    refreshArtifactsForAttached: async () => 0,
    repairRegexBindingsForAttached: async () => ({ repaired: 0, refreshed: 0 }),
    applyModuleRegexReplaceStringTransform: async () => ({ scanned: 0, updated: 0, failed: 0 }),
    applyModuleRegexRowPatch: async () => ({ scanned: 0, updated: 0, failed: 0 }),
    listWorldBookEntries: async () => [],
    updateWorldBookEntryActivation: async () => {},
    writeEnvelope: async () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('module migration dependencies', () => {
  test('keeps the historical migration registry', () => {
    expect(MODULE_MIGRATIONS.map(({ version }) => version)).toEqual([
      5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(CURRENT_MODULE_SCHEMA_VERSION).toBe(17);
  });

  test('v5 refreshes attachments and keeps operational failures nonfatal', async () => {
    const successful = await step(5).apply(args, makeDeps({
      refreshArtifactsForAttached: async (moduleId) => {
        expect(moduleId).toBe(env.id);
        return 2;
      },
    }));
    const warnings: string[] = [];
    const failed = await step(5).apply(args, makeDeps({
      refreshArtifactsForAttached: async () => { throw new Error('network'); },
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    }));

    expect(successful.notes).toEqual(['refreshed 2 attached char(s)']);
    expect(failed.notes).toEqual([]);
    expect(warnings).toEqual([
      'migrate-module(module-1) v5: refreshArtifactsForAttached threw: network',
    ]);
  });

  test('v6 applies the style transform in place and reports failed rows', async () => {
    let transformed = '';
    const result = await step(6).apply(args, makeDeps({
      applyModuleRegexReplaceStringTransform: async (moduleId, transform) => {
        expect(moduleId).toBe(env.id);
        transformed = transform('<style>.x-risu-card{color:red}</style><div class="x-risu-card">');
        return { scanned: 2, updated: 1, failed: 1 };
      },
    }));

    expect(transformed).toContain('<style>.card');
    expect(transformed).toContain('class="x-risu-card"');
    expect(result.notes).toEqual(['scanned=2', 'updated=1', 'failed=1']);
  });

  test('v7 keeps each phase-specific row patch', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(7).apply(args, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        patches.push(patch({ metadata: { _risu: { source_type: 'editprocess' } }, placement: ['world_info', 'ai_output'] }));
        patches.push(patch({ metadata: { _risu: { source_type: 'edittrans' } }, target: 'prompt' }));
        patches.push(patch({ metadata: { _risu: { source_type: 'editdisplay' } }, placement: ['ai_output'] }));
        patches.push(patch({ metadata: { _risu: { source_type: 'other' } } }));
        return { scanned: 4, updated: 3, failed: 0 };
      },
    }));

    expect(patches).toEqual([
      { placement: ['ai_output'] },
      { disabled: true, target: 'display', placement: ['ai_output', 'user_input'] },
      { placement: ['ai_output', 'user_input'] },
      null,
    ]);
  });

  test('v8 reroutes only escaped per-message rows', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(8).apply(args, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        patches.push(patch({ substitute_macros: 'escaped', replace_string: '{{chat_index}}' }));
        patches.push(patch({ substitute_macros: 'escaped', replace_string: '{{user}}' }));
        patches.push(patch({ substitute_macros: 'none', replace_string: '{{chat_index}}' }));
        return { scanned: 3, updated: 1, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ substitute_macros: 'after' }, null, null]);
  });

  test('v12 normalizes only display rows', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(12).apply(args, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        patches.push(patch({
          target: 'display',
          replace_string: '<style>.x{color:red}</style><div class="x">UI</div>',
        }));
        patches.push(patch({ target: 'prompt', replace_string: '<style>.x{}</style>' }));
        return { scanned: 2, updated: 1, failed: 0 };
      },
    }));

    expect(patches[0]?.['replace_string']).toStartWith(
      '<div data-lr-style-wrap class="not-island-prose">',
    );
    expect(patches[1]).toBeNull();
  });

  test('v14 moves only CBS-action rows to find mode', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    await step(14).apply(args, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        patches.push(patch({ substitute_macros: 'none', metadata: { _risu: { flag_actions: ['cbs'] } } }));
        patches.push(patch({ substitute_macros: 'none', metadata: { _risu: { flag_actions: ['move'] } } }));
        patches.push(patch({ substitute_macros: 'after', metadata: { _risu: { flag_actions: ['cbs'] } } }));
        return { scanned: 3, updated: 1, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ substitute_macros: 'find' }, null, null]);
  });

  test('v16 requires the verified refresh operation to succeed', async () => {
    const successful = await step(16).apply(args, makeDeps({
      refreshArtifactsForAttached: async () => 3,
    }));

    expect(successful.notes).toEqual(['migrated ownership for 3 module attachment(s)']);
    await expect(step(16).apply(args, makeDeps({
      refreshArtifactsForAttached: async () => { throw new Error('not verified'); },
    }))).rejects.toThrow('not verified');
  });

  test('v17 fills only empty folders and rejects failed rows', async () => {
    const patches: Array<Record<string, unknown> | null> = [];
    const successful = await step(17).apply(args, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        patches.push(patch({ folder: '' }));
        patches.push(patch({ folder: 'Custom' }));
        return { scanned: 2, updated: 1, failed: 0 };
      },
    }));

    expect(patches).toEqual([{ folder: 'Module: Module' }, null]);
    expect(successful.notes).toEqual(['grouped 1 regex_script(s)']);
    await expect(step(17).apply(args, makeDeps({
      applyModuleRegexRowPatch: async () => ({ scanned: 1, updated: 0, failed: 1 }),
    }))).rejects.toThrow('module regex folder backfill did not complete');
  });
});
