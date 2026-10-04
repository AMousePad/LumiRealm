import { describe, expect, test } from 'bun:test';
import { applyActivePreset } from '../../src/state/preset-regex-activation.js';
import {
  SYNTHETIC_REGEX,
  makePresetBackend,
  makeRegexStore,
  presetBytes,
  type RegexStore,
} from '../realm/preset-regex-fixture.js';

const USER = 'u1';
const RULE_NAMES = ['tag alpha', 'tag beta', 'tag gamma'];
// Risu's translation phase has no host equivalent, so this rule imports disabled on its own.
const REGEX = [...SYNTHETIC_REGEX, { comment: 'tag delta', in: '<delta>', out: '', type: 'edittrans', ableFlag: false }];

async function importTwoPresets(store: RegexStore = makeRegexStore()) {
  const { backend, presetIds } = makePresetBackend(store);
  await backend.importAnyFormat(presetBytes(REGEX, 'First'), 'first.risup', USER);
  await backend.importAnyFormat(presetBytes(REGEX, 'Second'), 'second.risup', USER);
  return { store, first: presetIds[0]!, second: presetIds[1]! };
}

function enabledRules(store: RegexStore, presetId: string): string[] {
  return store.rowsFor(USER).filter((row) => row.preset_id === presetId && !row.disabled).map((row) => row.name);
}

function storedRow(store: RegexStore, presetId: string, name: string) {
  const row = store.all().find((r) => r.dto.preset_id === presetId && r.dto.name === name);
  expect(row).toBeDefined();
  return row!.dto;
}

describe('preset regex activation', () => {
  test('imported rules start suspended', async () => {
    const { store } = await importTwoPresets();

    expect(store.rowsFor(USER).filter((row) => !row.disabled)).toEqual([]);
  });

  test('only the active preset runs its rules, and a repeated report writes nothing', async () => {
    const { store, first, second } = await importTwoPresets();

    await applyActivePreset(store.api, USER, first);
    expect(enabledRules(store, first)).toEqual(RULE_NAMES);
    expect(enabledRules(store, second)).toEqual([]);
    const writes = store.calls.update;
    await applyActivePreset(store.api, USER, first);
    expect(store.calls.update).toBe(writes);

    await applyActivePreset(store.api, USER, second);
    expect(enabledRules(store, first)).toEqual([]);
    expect(enabledRules(store, second)).toEqual(RULE_NAMES);

    await applyActivePreset(store.api, USER, null);
    expect(store.rowsFor(USER).filter((row) => !row.disabled)).toEqual([]);
  });

  test('a rule the user disabled stays disabled when its preset comes back', async () => {
    const { store, first, second } = await importTwoPresets();
    await applyActivePreset(store.api, USER, first);
    storedRow(store, first, 'tag beta').disabled = true;

    await applyActivePreset(store.api, USER, second);
    await applyActivePreset(store.api, USER, first);

    expect(enabledRules(store, first)).toEqual(['tag alpha', 'tag gamma']);
  });

  test('a row this extension cannot change is left as it is', async () => {
    const { store, first, second } = await importTwoPresets();
    Object.assign(storedRow(store, second, 'tag alpha'), { can_mutate: false, disabled: false });

    await applyActivePreset(store.api, USER, first);

    expect(enabledRules(store, second)).toEqual(['tag alpha']);
  });

  test('overlapping switches settle on the last one', async () => {
    const { store, first, second } = await importTwoPresets();

    await Promise.all([
      applyActivePreset(store.api, USER, first),
      applyActivePreset(store.api, USER, second),
    ]);

    expect(enabledRules(store, first)).toEqual([]);
    expect(enabledRules(store, second)).toEqual(RULE_NAMES);
  });

  test('a preset activated while its rules are still being created ends up active', async () => {
    let activation: Promise<void> | null = null;
    const store = makeRegexStore({
      beforeCreate: (input) => {
        activation ??= applyActivePreset(store.api, USER, (input as { preset_id?: string }).preset_id ?? null);
      },
    });
    const { backend, presetIds } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(REGEX), 'synthetic.risup', USER);
    await activation;

    expect(enabledRules(store, presetIds[0]!)).toEqual(RULE_NAMES);
  });
});
