import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_NAI_SETTINGS,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeNaiSettings,
  normalizeSettingsPatch,
  type UserStorageLike,
} from '../../src/state/settings-store.js';

function storageWith(value: unknown): UserStorageLike {
  return {
    async getJson<T>() { return value as T; },
    async setJson() {},
  };
}

describe('imageConnectionId and naiSettings in settings-store', () => {
  test('DEFAULT_SETTINGS initializes imageConnectionId and naiSettings', () => {
    expect(DEFAULT_SETTINGS.imageConnectionId).toBe(null);
    expect(DEFAULT_SETTINGS.imageModelOverride).toBe(null);
    expect(DEFAULT_SETTINGS.naiSettings).toEqual(DEFAULT_NAI_SETTINGS);
    expect(DEFAULT_SETTINGS.naiSettings.resolution).toBe('832x1216');
    expect(DEFAULT_SETTINGS.naiSettings.sampler).toBe('k_euler_ancestral');
    expect(DEFAULT_SETTINGS.naiSettings.steps).toBe(28);
    expect(DEFAULT_SETTINGS.naiSettings.guidance).toBe(5.0);
  });

  test('loadSettings defaults imageConnectionId and naiSettings if missing', async () => {
    const stored = { schema_version: 1, auxConnectionId: null };
    const settings = await loadSettings(storageWith(stored), 'user-1');
    expect(settings.imageConnectionId).toBe(null);
    expect(settings.imageModelOverride).toBe(null);
    expect(settings.naiSettings).toEqual(DEFAULT_NAI_SETTINGS);
  });

  test('loadSettings preserves stored imageConnectionId and naiSettings', async () => {
    const stored = {
      schema_version: 1,
      auxConnectionId: null,
      auxModelOverride: null,
      imageConnectionId: 'conn-nai-1',
      imageModelOverride: 'nai-diffusion-3',
      naiSettings: {
        resolution: '1024x1024',
        sampler: 'k_dpmpp_2s_ancestral',
        steps: 30,
        guidance: 6.5,
        smea: true,
        smeaDyn: true,
        qualityToggle: false,
      },
    };
    const settings = await loadSettings(storageWith(stored), 'user-1');
    expect(settings.imageConnectionId).toBe('conn-nai-1');
    expect(settings.imageModelOverride).toBe('nai-diffusion-3');
    expect(settings.naiSettings.resolution).toBe('1024x1024');
    expect(settings.naiSettings.sampler).toBe('k_dpmpp_2s_ancestral');
    expect(settings.naiSettings.steps).toBe(30);
    expect(settings.naiSettings.guidance).toBe(6.5);
    expect(settings.naiSettings.smea).toBe(true);
    expect(settings.naiSettings.smeaDyn).toBe(true);
    expect(settings.naiSettings.qualityToggle).toBe(false);
  });

  test('normalizeSettingsPatch normalizes imageConnectionId and naiSettings', () => {
    const patch = normalizeSettingsPatch({
      imageConnectionId: '  conn-img-xyz  ',
      imageModelOverride: '  custom-model  ',
      naiSettings: {
        steps: 45,
        guidance: 8.5,
        resolution: '1216x832',
      },
    });
    expect(patch.imageConnectionId).toBe('conn-img-xyz');
    expect(patch.imageModelOverride).toBe('custom-model');
    expect(patch.naiSettings?.steps).toBe(45);
    expect(patch.naiSettings?.guidance).toBe(8.5);
    expect(patch.naiSettings?.resolution).toBe('1216x832');
  });

  test('normalizeNaiSettings bounds steps and guidance', () => {
    const minClamped = normalizeNaiSettings({ steps: -5, guidance: -2 });
    expect(minClamped.steps).toBe(1);
    expect(minClamped.guidance).toBe(1);

    const maxClamped = normalizeNaiSettings({ steps: 100, guidance: 50 });
    expect(maxClamped.steps).toBe(50);
    expect(maxClamped.guidance).toBe(20);
  });
});
