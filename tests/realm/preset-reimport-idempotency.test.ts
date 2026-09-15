import { describe, expect, test } from 'bun:test';
import type { RegexScriptDTO } from 'lumiverse-spindle-types';
import type { RisuPresetRaw } from '../../src/core/preset/risup-decoder.js';
import { translateRisuPreset } from '../../src/core/preset/risup-translator.js';
import {
  PRESET_NAME,
  SYNTHETIC_REGEX,
  makePresetBackend,
  makeRegexStore,
  presetBytes,
  seededRow,
  syntheticPresetRaw,
  syntheticRule,
} from './preset-regex-fixture.js';

const USER = 'u1';

function expectedRules() {
  const raw = syntheticPresetRaw() as unknown as RisuPresetRaw;
  return translateRisuPreset(raw, 'synthetic.risup').regexScripts;
}

function findRegexRow(store: ReturnType<typeof makeRegexStore>, pattern: string) {
  const row = store.rowsFor(USER).find((r) => r.find_regex === pattern);
  expect(row).toBeDefined();
  return row!;
}

/** The user side of the host UI: edits land on the stored row. */
function editRow(store: ReturnType<typeof makeRegexStore>, id: string, patch: Partial<RegexScriptDTO>) {
  const stored = store.all().find((r) => r.dto.id === id);
  expect(stored).toBeDefined();
  Object.assign(stored!.dto, patch);
}

describe('preset regex re-import', () => {
  test('a first import still creates one row per rule, with the translated shape', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    const rows = store.rowsFor(USER);
    expect(rows).toHaveLength(SYNTHETIC_REGEX.length);
    expect(store.creates).toEqual(expectedRules());
    for (const row of rows) {
      expect(row.folder).toBe(PRESET_NAME);
      expect(row.scope).toBe('global');
      expect(row.scope_id).toBe(null);
      expect(row.can_mutate).toBe(true);
      expect(row.script_id).toBe('');
    }
  });

  test('re-importing the same archive reuses its rows instead of duplicating them', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    const firstIds = store.rowsFor(USER).map((r) => r.id);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    expect(store.rowsFor(USER).map((r) => r.id)).toEqual(firstIds);
    expect(store.calls.create).toBe(SYNTHETIC_REGEX.length);
  });

  test('a disabled imported row stays disabled across a re-import', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    const target = findRegexRow(store, '<alpha>(.+?)</alpha>');
    editRow(store, target.id, { disabled: true });

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    const rows = store.rowsFor(USER);
    expect(rows).toHaveLength(SYNTHETIC_REGEX.length);
    expect(rows.filter((r) => r.disabled).map((r) => r.id)).toEqual([target.id]);
    expect(store.calls.update).toBe(0);
  });

  test('a user-edited imported row is kept and reported, never overwritten', async () => {
    const store = makeRegexStore();
    const { backend, warns } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    const edited = findRegexRow(store, '<alpha>(.+?)</alpha>');
    editRow(store, edited.id, { replace_string: '<b>user replacement</b>' });

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    const rows = store.rowsFor(USER);
    const kept = rows.filter((r) => r.id === edited.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.replace_string).toBe('<b>user replacement</b>');
    // The edited row no longer matches the archive rule, so the archive value
    // lands beside it rather than over it.
    expect(rows).toHaveLength(SYNTHETIC_REGEX.length + 1);
    expect(warns.some((w) => w.includes('kept 1 unmatched row(s)'))).toBe(true);
  });

  test('a rule dropped from the archive keeps its row and is re-adopted when it returns', async () => {
    const store = makeRegexStore();
    const { backend, warns } = makePresetBackend(store);
    const withBeta = SYNTHETIC_REGEX;
    const withoutBeta = SYNTHETIC_REGEX.filter((r) => r.comment !== 'tag beta');

    await backend.importAnyFormat(presetBytes(withBeta), 'synthetic.risup', USER);
    const betaRow = findRegexRow(store, '<beta>(.+?)</beta>');

    await backend.importAnyFormat(presetBytes(withoutBeta), 'synthetic.risup', USER);
    expect(store.rowsFor(USER)).toHaveLength(withBeta.length);
    expect(findRegexRow(store, '<beta>(.+?)</beta>').id).toBe(betaRow.id);
    expect(warns.some((w) => w.includes('kept 1 unmatched row(s)'))).toBe(true);

    const createsBeforeReturn = store.calls.create;
    await backend.importAnyFormat(presetBytes(withBeta), 'synthetic.risup', USER);
    expect(store.rowsFor(USER)).toHaveLength(withBeta.length);
    expect(store.calls.create).toBe(createsBeforeReturn);
    expect(findRegexRow(store, '<beta>(.+?)</beta>').id).toBe(betaRow.id);
  });

  test('a reordered archive refreshes sort_order without adding rows', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store);
    const reordered = [SYNTHETIC_REGEX[2]!, SYNTHETIC_REGEX[0]!, SYNTHETIC_REGEX[1]!];

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    const idsBefore = store.rowsFor(USER).map((r) => r.id).sort();

    await backend.importAnyFormat(presetBytes(reordered), 'synthetic.risup', USER);

    expect(store.rowsFor(USER).map((r) => r.id).sort()).toEqual(idsBefore);
    expect(store.calls.create).toBe(SYNTHETIC_REGEX.length);
    // Front of the archive sorts first: sort_order stays archive-derived.
    expect(findRegexRow(store, '<gamma>(.+?)</gamma>').sort_order)
      .toBeLessThan(findRegexRow(store, '<alpha>(.+?)</alpha>').sort_order);
    expect(findRegexRow(store, '<alpha>(.+?)</alpha>').sort_order)
      .toBeLessThan(findRegexRow(store, '<beta>(.+?)</beta>').sort_order);
  });

  test('a host-owned row with identical content is neither matched nor touched', async () => {
    const archiveRule = expectedRules()[0]!;
    const host = seededRow(archiveRule, { id: 'host-row-1' });
    const store = makeRegexStore({ seed: [host] });
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    const hostAfter = store.rowsFor(USER).find((r) => r.id === 'host-row-1')!;
    expect(hostAfter.can_mutate).toBe(false);
    expect(hostAfter.updated_at).toBe(host.updated_at);
    expect(store.calls.update).toBe(0);
    expect(store.rowsFor(USER)).toHaveLength(SYNTHETIC_REGEX.length + 1);
  });

  test('another user gets its own rows, matched only against its own folder set', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', 'u2');

    expect(store.rowsFor(USER)).toHaveLength(SYNTHETIC_REGEX.length);
    expect(store.rowsFor('u2')).toHaveLength(SYNTHETIC_REGEX.length);
    expect(store.calls.create).toBe(SYNTHETIC_REGEX.length * 2);
    const first = new Set(store.rowsFor(USER).map((r) => r.id));
    for (const row of store.rowsFor('u2')) expect(first.has(row.id)).toBe(false);
  });

  test('a preset row lands in its own folder and leaves other folders alone', async () => {
    const otherFolder = syntheticRule({ name: 'other', find_regex: '<alpha>(.+?)</alpha>', folder: 'Other Folder' });
    const store = makeRegexStore({ seed: [seededRow(otherFolder, { id: 'other-row-1', canMutate: true })] });
    const { backend } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    const other = store.rowsFor(USER).find((r) => r.id === 'other-row-1')!;
    expect(other.folder).toBe('Other Folder');
    expect(other.updated_at).toBe(1);
    expect(store.calls.update).toBe(0);
  });
});
