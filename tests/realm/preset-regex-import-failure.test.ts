import { describe, expect, test } from 'bun:test';
import { PresetRegexImportError } from '../../src/realm/backend.js';
import {
  SYNTHETIC_REGEX,
  makePresetBackend,
  makeRegexStore,
  presetBytes,
} from './preset-regex-fixture.js';

const USER = 'u1';

describe('preset regex import failures', () => {
  test('rules that need the at-action runtime fail the import before anything is created', async () => {
    const store = makeRegexStore();
    const { backend, creates, progress } = makePresetBackend(store);
    const regex = [
      ...SYNTHETIC_REGEX,
      { comment: 'mood', in: '<mood>', out: '@@emo happy', type: 'editoutput', ableFlag: false },
      { comment: 'stash', in: '<stash>', out: '', type: 'editoutput', ableFlag: true, flag: 'g<inject>' },
    ];

    const result = backend.importAnyFormat(presetBytes(regex), 'synthetic.risup', USER);

    await expect(result).rejects.toThrow(PresetRegexImportError);
    await expect(result).rejects.toThrow(/rule 4 "mood" uses @@emo.*rule 5 "stash" uses @@inject/);
    expect(creates).toHaveLength(0);
    expect(store.calls.create).toBe(0);
    expect(progress.map((p) => p.phase)).not.toContain('done');
    expect(progress.at(-1)!.phase).toBe('error');
  });

  test('a rule the host rejects rolls back the preset and the rules created before it', async () => {
    const store = makeRegexStore({
      beforeCreate: (input) => {
        if (input.find_regex.includes('beta')) throw new Error('Invalid regex pattern');
      },
    });
    const { backend, presetIds, deletedPresetIds, progress } = makePresetBackend(store);

    const result = backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER);

    await expect(result).rejects.toThrow(PresetRegexImportError);
    await expect(result).rejects.toThrow(/"tag beta": Invalid regex pattern/);
    expect(store.calls.create).toBe(SYNTHETIC_REGEX.length);
    expect(deletedPresetIds).toEqual(presetIds);
    expect(store.rowsFor(USER)).toHaveLength(0);
    expect(progress.map((p) => p.phase)).not.toContain('done');
    expect(progress.at(-1)!.message).toContain('"tag beta": Invalid regex pattern');
  });

  test('a host that stores rules without the preset link fails the import and deletes them', async () => {
    const store = makeRegexStore({ dropPresetLink: true });
    const { backend, presetIds, deletedPresetIds, progress } = makePresetBackend(store);

    await expect(backend.importAnyFormat(presetBytes(), 'synthetic.risup', USER))
      .rejects.toThrow(/without its preset link/);
    expect(deletedPresetIds).toEqual(presetIds);
    expect(store.rowsFor(USER)).toHaveLength(0);
    expect(progress.at(-1)!.phase).toBe('error');
  });
});
