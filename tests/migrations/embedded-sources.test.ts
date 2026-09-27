import { expect, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { projectCharacterRegexScripts } from '../../src/payload/character-regex-projection.js';
import { createEmbeddedSourceRetirementPatch } from '../../src/migrations/embedded-sources.js';
import { CHARACTER_MIGRATIONS, migrateCharacterIfNeeded, type CharacterMigrationStepArgs, type MigrationDeps } from '../../src/migrations/character.js';
import type { LumirealmCharacterData } from '../../src/payload/types.js';

type Row = Record<string, unknown>;
function fixture(): Row {
  const rows = mapRegex([{
    comment: 'Obsolete source', in: 'source', out: 'replacement', type: 'editdisplay',
    flag: 'g', ableFlag: true,
  }], { characterId: 'character', uuid: () => 'stored-script' }).rows;
  return projectCharacterRegexScripts(rows, 'character', 'Synthetic')[0]! as unknown as Row;
}

function migrationDeps(overrides: Partial<MigrationDeps>): MigrationDeps {
  const unexpected = async (): Promise<never> => { throw new Error('unexpected migration dependency'); };
  return {
    extensionVersion: 'test', log: { info() {}, warn() {}, error() {} },
    installCharacterRegexScripts: unexpected, reinstallAttachedModules: unexpected,
    dispatchSvgRasterize: () => { throw new Error('unexpected rasterization'); },
    getAvatarImageId: unexpected, getCharacterWorldBookIds: unexpected,
    listWorldBookEntries: unexpected, updateWorldBookEntryExtensions: unexpected,
    updateWorldBookEntryActivation: unexpected, applyCharacterRegexReplaceStringTransform: unexpected,
    applyCharacterRegexRowPatch: unexpected, writeEnvelope: unexpected,
    ...overrides,
  };
}

test('retires only the unchanged row and accepts the host target and script ID forms', () => {
  const source = fixture();
  const original = structuredClone(source);
  const patch = createEmbeddedSourceRetirementPatch([source]);
  const live: Row = { ...source, script_id: 'stored_script', target: ['display'], id: 'host-row', can_mutate: true };
  expect(patch(live)).toEqual({ disabled: true });
  expect(patch(source)).toEqual({ disabled: true });
  expect(patch({ ...live, disabled: true })).toBeNull();
  expect(source).toEqual(original);
  expect(live.disabled).toBe(false);
});

for (const [field, value] of Object.entries({
  script_id: 'other', name: 'Edited name', find_regex: 'edited', replace_string: 'edited',
  flags: 'gi', placement: ['ai_output'], scope: 'global', scope_id: 'other', target: ['prompt'],
  min_depth: 1, max_depth: 3, trim_strings: ['x'], run_on_edit: true,
  substitute_macros: 'find', sort_order: 99, description: 'edited', folder: 'User folder',
  actions: [{ id: 'custom', type: 'send' }], can_mutate: false,
})) {
  test(`preserves a live change to ${field}`, () => {
    const source = fixture();
    expect(createEmbeddedSourceRetirementPatch([source])({ ...source, [field]: value })).toBeNull();
  });
}

test('preserves attached, standalone, embedded, unmarked and metadata-edited rows', () => {
  const source = fixture();
  const risu = (source.metadata as { _risu: Row })._risu;
  const patch = createEmbeddedSourceRetirementPatch([source]);
  for (const extra of [
    { module_id: 'attached' }, { imported_regex: true }, { origin: 'module' },
    { order_index: 4 }, { unicode_flags: 'gu' },
  ]) expect(patch({ ...source, metadata: { _risu: { ...risu, ...extra } } })).toBeNull();
  expect(patch({ ...source, metadata: {} })).toBeNull();
  expect(patch({ ...source, metadata: { ...source.metadata as Row, match_actions: ['move_top'] } })).toBeNull();
});

test('rejects missing or ambiguous historical identity and leaves unrelated sources alone', () => {
  const source = fixture();
  expect(createEmbeddedSourceRetirementPatch([])(source)).toBeNull();
  expect(createEmbeddedSourceRetirementPatch([source, { ...source, script_id: 'stored_script' }])(source)).toBeNull();
  expect(createEmbeddedSourceRetirementPatch([{ ...source, metadata: {} }])(source)).toBeNull();
  expect(createEmbeddedSourceRetirementPatch([{ ...source, disabled: true }])(source)).toBeNull();
});

test('existing imports retire unchanged rows before persisting aligned embedded runtime data', async () => {
  const obsolete = fixture();
  const editedSource = { ...obsolete, script_id: 'edited-source' };
  const embedded = { comment: 'Embedded', type: 'input', conditions: [], effect: [{ type: 'triggerlua', code: 'print("embedded")' }] };
  const envelope = {
    translator_schema_version: 27,
    payload: { triggers: [], lua_scripts: [], at_actions: [], requires: { lua: false, lowLevelAccess: false, hostFeatures: [] } },
    regex_scripts: [obsolete, editedSource],
    user_overrides: { low_level_access_granted: true },
    source: {
      card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Source selection', extensions: { risuai: {} } } },
      module: { id: 'embedded-source', name: 'Embedded source', description: '', trigger: [embedded], regex: [] },
    },
  } as unknown as LumirealmCharacterData;
  const order: string[] = [];
  let saved: LumirealmCharacterData | undefined;
  const deps = migrationDeps({
    applyCharacterRegexRowPatch: async (_character, _user, patch) => {
      order.push('patch');
      expect(patch({ ...obsolete, target: ['display'] })).toEqual({ disabled: true });
      expect(patch({ ...editedSource, script_id: 'edited_source', replace_string: 'user edit' })).toBeNull();
      return { scanned: 2, updated: 1, failed: 0 };
    },
    writeEnvelope: async (_character, next) => { order.push('persist'); saved = next; },
  });
  const args = { envelope, characterId: 'character', characterName: 'Synthetic', userId: 'user' };
  expect((await migrateCharacterIfNeeded(args, deps)).kind).toBe('migrated');
  expect(order).toEqual(['patch', 'persist']);
  expect(saved?.regex_scripts[0]?.disabled).toBe(true);
  expect(saved?.regex_scripts[1]?.disabled).toBe(false);
  expect(saved?.payload.triggers).toMatchObject([{ comment: 'Embedded' }]);
  expect(saved?.payload.lua_scripts).toEqual(['print("embedded")']);
  expect(saved?.payload.requires.lua).toBe(true);
  order.length = 0;
  const failed = await migrateCharacterIfNeeded(args, {
    ...deps, applyCharacterRegexRowPatch: async () => ({ scanned: 1, updated: 0, failed: 1 }),
  });
  expect(failed.kind).toBe('failed');
  expect(order).toEqual([]);
});

test('retry mirrors rows already retired before a partial host failure', async () => {
  const sources = [fixture(), { ...fixture(), script_id: 'second' }];
  const live = structuredClone(sources);
  const args = {
    envelope: { source: { module: {} }, regex_scripts: sources, payload: {} },
    newBundle: { risuPayload: { triggers: [], lua_scripts: [], at_actions: [], requires: {} } },
  } as unknown as CharacterMigrationStepArgs;
  let failSecond = true;
  const deps = migrationDeps({ applyCharacterRegexRowPatch: async (_character, _user, patch) => {
    let updated = 0;
    for (let index = 0; index < live.length; index++) {
      const change = patch(live[index]!);
      if (change && (!failSecond || index === 0)) { Object.assign(live[index]!, change); updated++; }
    }
    return { scanned: 2, updated, failed: failSecond ? 1 : 0 };
  } });
  const step = CHARACTER_MIGRATIONS.find((entry) => entry.version === 28)!;
  await expect(step.apply(args, deps)).rejects.toThrow('failed to retire');
  expect(live.map((row) => row.disabled)).toEqual([true, false]);
  expect(sources.map((row) => row.disabled)).toEqual([false, false]);
  failSecond = false;
  const result = await step.apply(args, deps);
  expect(live.map((row) => row.disabled)).toEqual([true, true]);
  expect(result.nextEnvelope.regex_scripts.map((row) => row.disabled)).toEqual([true, true]);
});

test('embedded imports without active obsolete sources do not scan host regex rows', async () => {
  const source = fixture();
  const step = CHARACTER_MIGRATIONS.find((entry) => entry.version === 28)!;
  for (const rows of [[], [{ ...source, disabled: true }], [{ ...source, metadata: { _risu: { origin: 'module' } } }]]) {
    const args = {
      envelope: { source: { module: {} }, regex_scripts: rows, payload: {} },
      newBundle: { risuPayload: { triggers: [], lua_scripts: [], at_actions: [], requires: {} } },
    } as unknown as CharacterMigrationStepArgs;
    const result = await step.apply(args, migrationDeps({}));
    expect(result.nextEnvelope.regex_scripts).toEqual(args.envelope.regex_scripts);
  }
});

test('fatal embedded parsing leaves existing runtime data and regex rows untouched', async () => {
  const envelope = {
    translator_schema_version: 27,
    payload: { triggers: [{ comment: 'Existing' }], lua_scripts: ['print("existing")'], at_actions: [] },
    regex_scripts: [fixture()], user_overrides: { low_level_access_granted: true },
    source: {
      card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Source selection', extensions: { risuai: {} } } },
      module: { id: 'incomplete', trigger: [] },
    },
  } as unknown as LumirealmCharacterData;
  const original = structuredClone(envelope);
  const writes: string[] = [];
  const result = await migrateCharacterIfNeeded({ envelope, characterId: 'character', characterName: 'Synthetic', userId: 'user' }, migrationDeps({
    applyCharacterRegexRowPatch: async () => { writes.push('patch'); return { scanned: 1, updated: 1, failed: 0 }; },
    writeEnvelope: async () => { writes.push('persist'); },
  }));
  expect(result).toMatchObject({ kind: 'failed', error: expect.stringContaining('missing required') });
  expect(writes).toEqual([]);
  expect(envelope).toEqual(original);
});

test.each([true, false])('a card without a sidecar migrates character access %s without patching regex', async (access) => {
  const trigger = { type: 'input', conditions: [], lowLevelAccess: !access, effect: [] };
  const envelope = {
    translator_schema_version: 27,
    payload: { triggers: [trigger], lua_scripts: [''], at_actions: [], requires: { lowLevelAccess: !access } },
    regex_scripts: [fixture()],
    user_overrides: { low_level_access_granted: true },
    source: {
      card: { spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: 'Source selection', extensions: { risuai: { lowLevelAccess: access, triggerscript: [trigger] } },
      } },
      module: null,
    },
  } as unknown as LumirealmCharacterData;
  let saved: LumirealmCharacterData | undefined;
  const deps = migrationDeps({
    applyCharacterRegexRowPatch: async () => { throw new Error('unexpected regex patch'); },
    writeEnvelope: async (_id, next) => { saved = next; },
  });
  expect((await migrateCharacterIfNeeded({ envelope, characterId: 'character', characterName: 'Synthetic', userId: 'user' }, deps)).kind).toBe('migrated');
  expect(saved?.payload.triggers[0]).toMatchObject({ lowLevelAccess: access });
  expect(saved?.payload.requires.lowLevelAccess).toBe(access);
  expect(saved?.regex_scripts[0]).toBe(envelope.regex_scripts[0]);
  expect(trigger.lowLevelAccess).toBe(!access);
});
