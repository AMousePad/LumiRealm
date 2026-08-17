import { describe, expect, test } from 'bun:test';
import { checkHostVersion, readRuntimeVersionInfo } from './version-check.js';

describe('runtime version authority', () => {
  test('extracts extension, minimum, and host versions', () => {
    expect(readRuntimeVersionInfo({
      manifest: { version: '0.8.6', minimum_lumiverse_version: ' 1.1.5 ' },
      host: { lumiverseVersion: '1.1.5' },
    })).toEqual({
      extensionVersion: '0.8.6',
      minimumLumiverseVersion: '1.1.5',
      hostVersion: '1.1.5',
    });
  });

  test('accepts equal and newer hosts', () => {
    expect(checkHostVersion('1.1.5', '1.1.5').needsUpdate).toBe(false);
    expect(checkHostVersion('1.2.0', '1.1.5').needsUpdate).toBe(false);
  });

  test('rejects an older host', () => {
    const result = checkHostVersion('1.1.4', '1.1.5');
    expect(result.needsUpdate).toBe(true);
    expect(result.hostVersion).toBe('1.1.4');
    expect(result.minimum).toBe('1.1.5');
  });

  test('requires a non-empty manifest minimum', () => {
    expect(() => readRuntimeVersionInfo({
      manifest: { version: '0.8.6' },
      host: { lumiverseVersion: '1.1.5' },
    })).toThrow('spindle.manifest.minimum_lumiverse_version');
    expect(() => readRuntimeVersionInfo({
      manifest: { version: '0.8.6', minimum_lumiverse_version: '   ' },
      host: { lumiverseVersion: '1.1.5' },
    })).toThrow('spindle.manifest.minimum_lumiverse_version');
  });
});
