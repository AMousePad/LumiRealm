import { expect, test } from 'bun:test';
import { mapLoreBook } from '../../src/core/mappers/lorebook.js';
import { loreBookSchema } from '../../src/core/schemas/lorebook.js';
import { computeEntrySourceHash } from '../../src/core/mappers/lorebook-hash.js';
import { lorePriorityPatch, lorePriorityTargets } from '../../src/migrations/lore-priority.js';
import { CHARACTER_MIGRATIONS, type MigrationDeps, type CharacterMigrationStepArgs } from '../../src/migrations/character.js';
import { MODULE_MIGRATIONS, migrateModuleIfNeeded, type ModuleMigrationDeps } from '../../src/migrations/module.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';

const source = loreBookSchema.parse({ key: 'pilot', content: 'Profile', insertorder: 780 });
const projected = mapLoreBook([source], { worldBookId: 'book' })[0]!;
const old = { ...projected, priority: 0 };
const live = {
  ...old, id: 'live', content: 'Edited profile', disabled: true,
  extensions: { ...old.extensions, _risu_source_hash: computeEntrySourceHash(old), custom: 'preserved' },
};

test('priority repair changes only the old default and source stamp, retaining edits', () => {
  const targets = lorePriorityTargets([projected as unknown as Record<string, unknown>]);
  const patch = lorePriorityPatch(live, targets)!;
  expect(Object.keys(patch).sort()).toEqual(['extensions', 'priority']);
  expect(patch.priority).toBe(780);
  expect(patch.extensions.custom).toBe('preserved');
  expect(patch.extensions._risu_source_hash).toBe(computeEntrySourceHash(projected as unknown as Record<string, unknown>));
  expect(lorePriorityPatch({ ...live, ...patch }, targets)).toBeNull();
  expect(lorePriorityPatch({ ...live, priority: 7 }, targets)).toBeNull();
  expect(lorePriorityPatch({ ...live, extensions: {} }, targets)).toBeNull();
  expect(lorePriorityPatch({ ...live, extensions: { _risu_source_hash: 'other-source' } }, targets)).toBeNull();
});

test('explicit priority decorators do not become migration defaults', () => {
  const rows = mapLoreBook([loreBookSchema.parse({ ...source, content: '@@priority 3\nProfile' })], { worldBookId: 'book' });
  expect(lorePriorityTargets(rows as unknown as Record<string, unknown>[]).size).toBe(0);
});

test('character priority migration leaves module and native entries alone', async () => {
  const patches: unknown[] = [];
  const args = { characterId: 'character', userId: 'user', envelope: {}, newBundle: { worldBookEntries: [projected] } } as unknown as CharacterMigrationStepArgs;
  const deps = {
    getCharacterWorldBookIds: async () => ['book'],
    listWorldBookEntries: async () => [live,
      { ...live, id: 'module', extensions: { ...live.extensions, _risu_module_id: 'module' } },
      { ...live, id: 'native', extensions: {} },
    ],
    updateWorldBookEntryActivation: async (id: string, patch: unknown) => { patches.push({ id, patch }); },
  } as unknown as MigrationDeps;
  await CHARACTER_MIGRATIONS.find((step) => step.version === 26)!.apply(args, deps);
  expect(patches).toEqual([{ id: 'live', patch: {
    ...lorePriorityPatch(live, lorePriorityTargets([projected as unknown as Record<string, unknown>])),
    exclude_greeting: true,
  } }]);
});

test('module priority migration is owner-scoped and does not advance after a failed write', async () => {
  const env = {
    id: 'module', installed_world_book_id: 'book', translator_schema_version: 19,
    module: { lorebook: [source] },
  } as unknown as ModuleEnvelope;
  const owned = { ...live, extensions: { ...live.extensions, _risu_module_id: env.id } };
  const patches: string[] = [];
  const deps = {
    listWorldBookEntries: async () => [owned, live],
    updateWorldBookEntryActivation: async (id: string) => { patches.push(id); },
  } as unknown as ModuleMigrationDeps;
  await MODULE_MIGRATIONS.find((step) => step.version === 20)!.apply({ env }, deps);
  expect(patches).toEqual(['live']);
  let written = false;
  const result = await migrateModuleIfNeeded(env, {
    ...deps,
    updateWorldBookEntryActivation: async () => { throw new Error('write failed'); },
    writeEnvelope: async () => { written = true; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  expect(result.kind).toBe('failed');
  expect(written).toBe(false);
});

test('older greeting migrations retain the zero-priority provenance for the subsequent repair', async () => {
  const beforeGreeting = { ...old, exclude_greeting: false };
  let row = { ...beforeGreeting, extensions: {
    ...beforeGreeting.extensions, _risu_source_hash: computeEntrySourceHash(beforeGreeting),
  } };
  const args = { characterId: 'character', userId: 'user', envelope: {}, newBundle: { worldBookEntries: [projected] } } as unknown as CharacterMigrationStepArgs;
  const deps = {
    getCharacterWorldBookIds: async () => ['book'], listWorldBookEntries: async () => [row],
    updateWorldBookEntryActivation: async (_id: string, patch: Partial<typeof row>) => { row = { ...row, ...patch }; },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as MigrationDeps;
  await CHARACTER_MIGRATIONS.find((step) => step.version === 15)!.apply(args, deps);
  expect(row.exclude_greeting).toBe(true);
  expect(row.priority).toBe(0);
  await CHARACTER_MIGRATIONS.find((step) => step.version === 26)!.apply(args, deps);
  expect(row.priority).toBe(780);
  expect(row.extensions._risu_source_hash).toBe(computeEntrySourceHash(projected as unknown as Record<string, unknown>));
});
