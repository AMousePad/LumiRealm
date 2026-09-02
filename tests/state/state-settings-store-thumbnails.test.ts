import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettingsPatch,
  type UserStorageLike,
} from '../../src/state/settings-store.js';

function storageWith(value: unknown): UserStorageLike {
  return {
    async getJson<T>() { return value as T; },
    async setJson() {},
  };
}

// Default-on: new imports skip thumbnails unless the user opts back in.
describe('skipAssetThumbnails setting', () => {
  test('DEFAULT_SETTINGS has it on', () => {
    expect(DEFAULT_SETTINGS.skipAssetThumbnails).toBe(true);
  });

  test('stored file without the field loads as true', async () => {
    const stored = { schema_version: 1, auxConnectionId: null, auxModelOverride: null };
    const settings = await loadSettings(storageWith(stored), 'user-1');
    expect(settings.skipAssetThumbnails).toBe(true);
  });

  test('stored explicit false is respected as an opt-out', async () => {
    const stored = {
      schema_version: 1,
      auxConnectionId: null,
      auxModelOverride: null,
      skipAssetThumbnails: false,
    };
    const settings = await loadSettings(storageWith(stored), 'user-1');
    expect(settings.skipAssetThumbnails).toBe(false);
  });

  test('patch coerces to boolean', () => {
    expect(normalizeSettingsPatch({ skipAssetThumbnails: true })).toEqual({ skipAssetThumbnails: true });
    expect(normalizeSettingsPatch({ skipAssetThumbnails: 0 })).toEqual({ skipAssetThumbnails: false });
    expect(normalizeSettingsPatch({})).toEqual({});
  });
});
