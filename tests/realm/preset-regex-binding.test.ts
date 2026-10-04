import { describe, expect, test } from 'bun:test';
import {
  SYNTHETIC_REGEX,
  makePresetBackend,
  makeRegexStore,
  presetBytes,
} from './preset-regex-fixture.js';

const USER = 'u1';

describe('preset regex binding', () => {
  test('binds every imported rule to the preset it was imported with', async () => {
    const store = makeRegexStore();
    const { backend, presetIds } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    expect(store.rowsFor(USER).map((row) => row.preset_id)).toEqual(SYNTHETIC_REGEX.map(() => presetIds[0]!));
  });

  test('a re-import binds its own rows to its own preset instead of reusing the first one', async () => {
    const store = makeRegexStore();
    const { backend, presetIds } = makePresetBackend(store);

    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);
    const firstRows = store.rowsFor(USER);
    await backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    expect(new Set(presetIds).size).toBe(2);
    const rows = store.rowsFor(USER);
    expect(rows.filter((row) => row.preset_id === presetIds[0])).toEqual(firstRows);
    expect(rows.filter((row) => row.preset_id === presetIds[1])).toHaveLength(SYNTHETIC_REGEX.length);
  });
});
