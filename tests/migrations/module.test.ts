import { describe, it, expect } from 'bun:test';
import {
  CURRENT_MODULE_SCHEMA_VERSION,
  MODULE_MIGRATIONS,
  migrateModuleIfNeeded,
  type ModuleMigrationDeps,
} from '../../src/migrations/module.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';

const baseModule = {
  id: 'src-id',
  name: 'TestModule',
  description: '',
  lorebook: null,
  regex: null,
  trigger: null,
  cjs: null,
  hideIcon: undefined,
  backgroundEmbedding: undefined,
  assets: null,
  namespace: undefined,
  customModuleToggle: undefined,
  mcp: undefined,
} as unknown as ModuleEnvelope['module'];

const makeEnv = (overrides: Partial<ModuleEnvelope> = {}): ModuleEnvelope => ({
  schema_version: 1,
  id: 'mod-1',
  filename: 'test.risum',
  uploaded_at: 1000,
  module: baseModule,
  asset_index: {
    Foo: { imageId: 'img-1' },
    Bar: { imageId: 'img-2' },
    Baz: { imageId: 'img-3' },
  },
  translator_schema_version: 4,
  ...overrides,
});

const makeDeps = (overrides: Partial<ModuleMigrationDeps> = {}): ModuleMigrationDeps => ({
  refreshArtifactsForAttached: async () => 0,
  repairRegexBindingsForAttached: async () => ({ repaired: 0, refreshed: 0 }),
  listWorldBookEntries: async () => [],
  updateWorldBookEntryActivation: async () => undefined,
  applyModuleRegexReplaceStringTransform: async () => ({ scanned: 0, updated: 0, failed: 0 }),
  applyModuleRegexRowPatch: async () => ({ scanned: 0, updated: 0, failed: 0 }),
  writeEnvelope: async () => undefined,
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  ...overrides,
});

describe('module migrations: v5 refresh attached regex', () => {
  it('calls refreshArtifactsForAttached and stamps version forward', async () => {
    const env = makeEnv();
    let written: ModuleEnvelope | null = null;
    const refreshLog: string[] = [];
    const result = await migrateModuleIfNeeded(env, makeDeps({
      writeEnvelope: async (e) => { written = e; },
      refreshArtifactsForAttached: async (mid) => { refreshLog.push(mid); return 2; },
    }));
    expect(result.kind).toBe('migrated');
    expect(refreshLog).toContain(env.id);
    expect(written).not.toBeNull();
    expect(written!.translator_schema_version).toBe(CURRENT_MODULE_SCHEMA_VERSION);
  });

  it('does not stamp ownership migration when refresh dependency is missing', async () => {
    const env = makeEnv();
    let written: ModuleEnvelope | null = null;
    const result = await migrateModuleIfNeeded(env, makeDeps({
      writeEnvelope: async (e) => { written = e; },
      refreshArtifactsForAttached: undefined as unknown as ModuleMigrationDeps['refreshArtifactsForAttached'],
    }));
    expect(result.kind).toBe('failed');
    expect(written!.translator_schema_version).toBe(15);
  });

  it('does not stamp ownership migration when verified refresh fails', async () => {
    const env = makeEnv();
    let written: ModuleEnvelope | null = null;
    const result = await migrateModuleIfNeeded(env, makeDeps({
      writeEnvelope: async (e) => { written = e; },
      refreshArtifactsForAttached: async () => { throw new Error('boom'); },
    }));
    expect(result.kind).toBe('failed');
    expect(written!.translator_schema_version).toBe(15);
  });

  it('is idempotent (already at current version is noop)', async () => {
    const env = makeEnv({
      translator_schema_version: CURRENT_MODULE_SCHEMA_VERSION,
    });
    const refreshLog: string[] = [];
    const result = await migrateModuleIfNeeded(env, makeDeps({
      refreshArtifactsForAttached: async (mid) => { refreshLog.push(mid); return 0; },
    }));
    expect(result.kind).toBe('noop');
    expect(refreshLog).toHaveLength(0);
  });

  it('runs corrected greeting migration after rolled-back v9 was persisted', async () => {
    const env = makeEnv({ translator_schema_version: 9 });
    let writtenVersion = 0;
    const result = await migrateModuleIfNeeded(env, makeDeps({
      writeEnvelope: async (written) => {
        writtenVersion = written.translator_schema_version ?? 0;
      },
    }));
    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') throw new Error('not migrated');
    expect(result.stepsApplied.map((step) => step.version)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(writtenVersion).toBe(19);
  });

  it('repairs existing source-row bindings once', async () => {
    const env = makeEnv({ translator_schema_version: 10 });
    const repairLog: string[] = [];
    const result = await migrateModuleIfNeeded(env, makeDeps({
      repairRegexBindingsForAttached: async (mid) => {
        repairLog.push(mid);
        return { repaired: 1, refreshed: 0 };
      },
    }));

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') throw new Error('not migrated');
    expect(result.stepsApplied.map((step) => step.version)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(repairLog).toEqual([env.id]);
  });

  it('strips legacy island wrappers from module display rows in v19', async () => {
    const env = makeEnv({ translator_schema_version: 18 });
    const patched: Array<Record<string, unknown> | null> = [];
    const legacy = '<div data-lr-style-wrap class="not-island-prose">'
      + '<style data-risu-island-trigger></style>'
      + '<div class="x">UI</div>'
      + '</div>';
    const result = await migrateModuleIfNeeded(env, makeDeps({
      applyModuleRegexRowPatch: async (_mid, patch) => {
        // Live rows carry target as an array; the scalar shape masked the
        // burned v18 no-op.
        patched.push(patch({ target: ['display'], replace_string: legacy }));
        patched.push(patch({ target: ['response'], replace_string: legacy }));
        return { scanned: 2, updated: 1, failed: 0 };
      },
    }));

    expect(result.kind).toBe('migrated');
    expect(patched[0]?.['replace_string']).toBe('<div class="x">UI</div>');
    expect(patched[1]).toBeNull();
  });

  it('moves CBS-only module rows to the native find mode', async () => {
    const env = makeEnv({ translator_schema_version: 13 });
    let patchResult: Record<string, unknown> | null = null;
    const result = await migrateModuleIfNeeded(env, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        const candidate = patch({
          substitute_macros: 'none',
          target: ['response'],
          placement: ['ai_output'],
          metadata: { _risu: { flag_actions: ['cbs'] } },
        });
        if (candidate?.['substitute_macros']) patchResult = candidate;
        return { scanned: 1, updated: 1, failed: 0 };
      },
    }));

    expect(result.kind).toBe('migrated');
    expect(patchResult as Record<string, unknown> | null).toEqual({ substitute_macros: 'find' });
  });

  it('exports v5 step with description', () => {
    const v5 = MODULE_MIGRATIONS.find((m) => m.version === 5);
    expect(v5).toBeDefined();
    expect(v5!.description).toContain('regex');
    expect(v5!.touches).toContain('regex_scripts_attached_chars');
  });

  it('groups only uncategorized module rows in v17', async () => {
    const env = makeEnv({ translator_schema_version: 16 });
    const patches: Array<Record<string, unknown> | null> = [];
    const result = await migrateModuleIfNeeded(env, makeDeps({
      applyModuleRegexRowPatch: async (_moduleId, patch) => {
        // Live rows carry array target/placement, no display target here.
        patches.push(patch({ folder: '', target: ['response'], placement: ['ai_output'], metadata: {} }));
        patches.push(patch({ folder: 'My Folder', target: ['response'], placement: ['ai_output'], metadata: {} }));
        return { scanned: 2, updated: 1, failed: 0 };
      },
    }));

    expect(result.kind).toBe('migrated');
    // v17 patches both rows, then v18 + v19 see them again (no display target, no-op).
    expect(patches).toEqual([{ folder: 'Module: TestModule' }, null, null, null, null, null]);
  });
});
