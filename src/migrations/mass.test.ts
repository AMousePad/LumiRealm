import { describe, expect, test } from 'bun:test';

import { createMassMigrationsRunner } from './mass.js';
import type { MigrationState, UserStorageLike } from './state.js';

const baseState: MigrationState = {
  schema_version: 1,
  last_swept_modules: 16,
  last_swept_characters: 20,
  display_owner_backfilled: true,
  retired_macro_projection_migrated_v2: true,
  vars_migrated_to_chat_scope: true,
};

function makeRunner(
  state: MigrationState,
  result: 'migrated' | 'failed',
) {
  let stored = state;
  const storage: UserStorageLike = {
    async getJson<T>() { return stored as T; },
    async setJson(_path, value) { stored = value as MigrationState; },
  };
  (globalThis as { spindle?: unknown }).spindle = { userStorage: storage };
  const checked = new Set<string>();
  const calls: Array<{ silent?: boolean }> = [];
  const runner = createMassMigrationsRunner({
    currentCharacterSchemaVersion: 20,
    currentModuleSchemaVersion: 16,
    translatorMigrationChecked: checked,
    getMissingPermissions: () => [],
    moduleStorage: () => ({}) as never,
    listModules: async () => [],
    readModuleEnvelope: async () => null,
    listLumirealmCharacters: async () => [{
      character: { id: 'char-1', name: 'Card' },
      data: { translator_schema_version: 19, display_owner: true } as never,
    }],
    writeLumirealm: async () => {},
    runModuleMigration: async () => ({ ok: true }),
    runCharacterMigration: async (_id, _name, _user, _data, opts) => {
      calls.push(opts ?? {});
      return result;
    },
    emitOperationProgress: () => {},
    toastFor: () => {},
    log: { info: () => {}, warn: () => {} },
    errMsg: String,
  });
  return { runner, checked, calls, state: () => stored };
}

describe('mass character migration completion', () => {
  test('checks card schemas even when the user-wide marker is current', async () => {
    const harness = makeRunner(baseState, 'migrated');
    await harness.runner.runMassCharacterMigrationIfNeeded('user-1');
    expect(harness.calls).toEqual([{ silent: true }]);
  });

  test('does not advance or retain the per-boot gate after a returned failure', async () => {
    const harness = makeRunner(
      { ...baseState, last_swept_characters: 19 },
      'failed',
    );
    await harness.runner.runMassCharacterMigrationIfNeeded('user-1');
    expect(harness.state().last_swept_characters).toBe(19);
    expect(harness.checked.has('char-1')).toBe(false);
  });
});
