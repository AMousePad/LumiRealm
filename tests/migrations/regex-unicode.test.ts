import { expect, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { projectModuleRegexEntries } from '../../src/state/module-artifact-project.js';
import { hostRegexCompileError, projectCharacterRegexScripts } from '../../src/payload/character-regex-projection.js';
import { unicodeRegexPatch } from '../../src/migrations/regex-unicode.js';
import { CHARACTER_MIGRATIONS, type CharacterMigrationStepArgs, type MigrationDeps } from '../../src/migrations/character.js';
import { MODULE_MIGRATIONS, type ModuleMigrationStepArgs, type ModuleMigrationDeps } from '../../src/migrations/module.js';
import type { CustomScript } from '../../src/core/schemas/customscript.js';

type Row = Record<string, unknown>;
const source: CustomScript = {
  in: '{{#if {{getvar::enabled}}}}.{{/if}}', out: 'X', flag: 'gu<cbs>', ableFlag: true, type: 'editdisplay', comment: 'Unicode pattern',
};
const characters = mapRegex([source], { characterId: 'character' }).rows;
const modules = projectModuleRegexEntries('module', 'Synthetic', null, [source], () => 'script');
function oldRow(row: unknown): Row {
  const copy = JSON.parse(JSON.stringify(row));
  delete copy.metadata._risu.unicode_flags;
  return copy;
}

for (const [origin, rows] of [['character', characters], ['module', modules]] as const) {
  test(`${origin}: nested Unicode patterns remain installable`, () => {
    const row = rows[0]!;
    expect(row.flags).toBe('g');
    expect((row.metadata._risu as Row).unicode_flags).toBe('gu');
    expect(hostRegexCompileError(row.find_regex, row.flags, row.substitute_macros)).toBeNull();
    expect(hostRegexCompileError(row.find_regex, 'gu', row.substitute_macros)).not.toBeNull();
  });
  test(`${origin}: backfill changes only metadata and preserves live edits`, () => {
    const sources = rows as unknown as Row[];
    const row: Row = { ...oldRow(rows[0]), disabled: true, replace_string: 'edited', sort_order: 900, actions: [{ id: 'keep' }] };
    const patch = unicodeRegexPatch(row, sources)!;
    expect(Object.keys(patch)).toEqual(['metadata']);
    expect((patch.metadata as { _risu: Row })._risu.unicode_flags).toBe('gu');
    expect({ ...row, ...patch }).toMatchObject({ disabled: true, replace_string: 'edited', sort_order: 900, actions: [{ id: 'keep' }] });
    expect(unicodeRegexPatch({ ...row, ...patch }, sources)).toBeNull();
    expect(unicodeRegexPatch({ ...row, flags: 'gi' }, sources)).toBeNull();
    expect(unicodeRegexPatch({ ...row, find_regex: 'edited' }, sources)).toBeNull();
    expect(unicodeRegexPatch({ ...row, target: ['prompt'] }, sources)).toBeNull();
    expect(unicodeRegexPatch(row, [...sources, ...sources])).toBeNull();
    const metadata = row.metadata as { _risu: Row };
    expect(unicodeRegexPatch({ ...row, metadata: { _risu: { ...metadata._risu, imported_regex: true } } }, sources)).toBeNull();
    expect(unicodeRegexPatch({ ...row, metadata: {} }, sources)).toBeNull();
  });
}
test('character projection retains Unicode metadata without parking a valid dynamic pattern', () => {
  const [row] = projectCharacterRegexScripts(characters, 'character', 'Synthetic');
  expect(row!.disabled).toBe(false);
  expect((row!.metadata._risu as Row).unicode_flags).toBe('gu');
});
test('character migration patches installed and saved rows without reinstalling', async () => {
  const stored = oldRow(characters[0]);
  const args = { characterId: 'character', userId: 'user', newBundle: { regexScripts: characters }, envelope: { regex_scripts: [stored] } } as unknown as CharacterMigrationStepArgs;
  let updated: Row | null = null;
  const deps = { applyCharacterRegexRowPatch: async (characterId, userId, patch) => {
    expect([characterId, userId]).toEqual(['character', 'user']);
    updated = patch(stored);
    return { scanned: 1, updated: 1, failed: 0 };
  } } as MigrationDeps;
  const step = CHARACTER_MIGRATIONS.find(row => row.version === 27)!;
  const result = await step.apply(args, deps);
  expect(updated).not.toBeNull();
  expect(result.nextEnvelope.regex_scripts[0]!.metadata).toEqual(updated!.metadata as Row);
  await expect(step.apply(args, { ...deps, applyCharacterRegexRowPatch: async () => ({ scanned: 1, updated: 0, failed: 1 }) })).rejects.toThrow('failed to restore Unicode');
});
test('module migration patches source-matched rows without refreshing attachments', async () => {
  const stored = oldRow(modules[0]);
  const args = { env: { id: 'module', module: { name: 'Synthetic', regex: [source] } } } as ModuleMigrationStepArgs;
  let updated: Row | null = null;
  const deps = { applyModuleRegexRowPatch: async (id, patch) => {
    expect(id).toBe('module');
    updated = patch(stored);
    return { scanned: 1, updated: 1, failed: 0 };
  } } as ModuleMigrationDeps;
  const step = MODULE_MIGRATIONS.find(row => row.version === 21)!;
  const result = await step.apply(args, deps);
  expect((updated!.metadata as { _risu: Row })._risu.unicode_flags).toBe('gu');
  expect(result.nextEnv).toBe(args.env);
  await expect(step.apply(args, { ...deps, applyModuleRegexRowPatch: async () => ({ scanned: 1, updated: 0, failed: 1 }) })).rejects.toThrow('failed to restore Unicode');
});
