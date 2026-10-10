/**
 * Pin pure asset_index mutation helpers. Both source kinds — character
 * (multi-source AssetIndexEntry) and module (single-source ModuleAssetRef)
 * — share an add/rename/delete shape with subtle semantic divergence:
 *   - Character add: APPENDS to existing imageIds[] (multi-source).
 *   - Module add: REPLACES existing imageId (single-source per spec).
 *   - Both rename: pure key rename, refuses on collision/missing/empty.
 *   - Both delete: idempotent.
 */

import { describe, test, expect } from 'bun:test';
import {
  type CharacterAssetIndex,
  type ModuleAssetIndex,
  addAssetToCharacterIndex,
  addAssetToModuleIndex,
  deleteCharacterAsset,
  deleteModuleAsset,
  renameCharacterAsset,
  renameModuleAsset,
} from '../../src/state/asset-index-mutate.js';

// ─── Character path ─────────────────────────────────────────────────────

describe('addAssetToCharacterIndex', () => {
  test('adds new entry on fresh name', () => {
    const r = addAssetToCharacterIndex({}, 'reimu', 'img-1', 'png');
    expect(r.ok).toBe(true);
    expect(r.index['reimu']).toEqual({ imageIds: ['img-1'], ext: 'png' });
  });

  test('appends imageId on EXISTING name (multi-source)', () => {
    const before: CharacterAssetIndex = {
      reimu: { imageIds: ['img-1'], ext: 'png' },
    };
    const r = addAssetToCharacterIndex(before, 'reimu', 'img-2', 'png');
    expect(r.ok).toBe(true);
    expect(r.index['reimu']).toEqual({ imageIds: ['img-1', 'img-2'], ext: 'png' });
  });

  test('preserves first-seen ext when adding new variant with different ext', () => {
    const before: CharacterAssetIndex = {
      reimu: { imageIds: ['img-1'], ext: 'png' },
    };
    const r = addAssetToCharacterIndex(before, 'reimu', 'img-2', 'mp4');
    expect(r.ok).toBe(true);
    expect(r.index['reimu']!.ext).toBe('png');
  });

  test('refuses to add same imageId twice to the same name', () => {
    const before: CharacterAssetIndex = {
      reimu: { imageIds: ['img-1'] },
    };
    const r = addAssetToCharacterIndex(before, 'reimu', 'img-1', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('already attached');
    expect(r.index).toBe(before);
  });

  test('refuses empty asset name + reports reason', () => {
    const r = addAssetToCharacterIndex({}, '   ', 'img-1', 'png');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('empty');
  });

  test('refuses empty imageId', () => {
    const r = addAssetToCharacterIndex({}, 'name', '', 'png');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('imageId');
  });

  test('trims whitespace from name on add', () => {
    const r = addAssetToCharacterIndex({}, '  spaced  ', 'img-1', undefined);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.index)).toEqual(['spaced']);
  });

  test('does not mutate the input index', () => {
    const before: CharacterAssetIndex = { x: { imageIds: ['a'] } };
    const snap = JSON.stringify(before);
    addAssetToCharacterIndex(before, 'x', 'b', undefined);
    expect(JSON.stringify(before)).toBe(snap);
  });

  test('omits ext key entirely when undefined (matches input style)', () => {
    const r = addAssetToCharacterIndex({}, 'no-ext', 'img-1', undefined);
    expect(r.ok).toBe(true);
    expect(r.index['no-ext']).toEqual({ imageIds: ['img-1'] });
    expect('ext' in r.index['no-ext']!).toBe(false);
  });
});

describe('renameCharacterAsset', () => {
  test('renames key, preserves entry', () => {
    const before: CharacterAssetIndex = {
      old_name: { imageIds: ['x'], ext: 'png' },
    };
    const r = renameCharacterAsset(before, 'old_name', 'new_name');
    expect(r.ok).toBe(true);
    expect(r.index).toEqual({ new_name: { imageIds: ['x'], ext: 'png' } });
  });

  test('refuses when newName already exists', () => {
    const before: CharacterAssetIndex = {
      a: { imageIds: ['x'] },
      b: { imageIds: ['y'] },
    };
    const r = renameCharacterAsset(before, 'a', 'b');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('already exists');
    expect(r.index).toBe(before);
  });

  test('refuses when oldName does not exist', () => {
    const r = renameCharacterAsset({}, 'nope', 'something');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not found');
  });

  test('refuses when newName is empty', () => {
    const before: CharacterAssetIndex = { a: { imageIds: ['x'] } };
    const r = renameCharacterAsset(before, 'a', '   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('empty');
  });

  test('refuses when newName equals oldName (post-trim)', () => {
    const before: CharacterAssetIndex = { same: { imageIds: ['x'] } };
    const r = renameCharacterAsset(before, 'same', 'same');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('identical');
  });

  test('preserves order of other entries', () => {
    const before: CharacterAssetIndex = {
      a: { imageIds: ['1'] },
      b: { imageIds: ['2'] },
      c: { imageIds: ['3'] },
    };
    const r = renameCharacterAsset(before, 'b', 'b_renamed');
    expect(r.ok).toBe(true);
    expect(Object.keys(r.index)).toEqual(['a', 'b_renamed', 'c']);
  });

  test('trims whitespace from newName', () => {
    const before: CharacterAssetIndex = { x: { imageIds: ['y'] } };
    const r = renameCharacterAsset(before, 'x', '  trimmed  ');
    expect(r.ok).toBe(true);
    expect(Object.keys(r.index)).toEqual(['trimmed']);
  });
});

describe('deleteCharacterAsset', () => {
  test('removes named entry', () => {
    const before: CharacterAssetIndex = {
      a: { imageIds: ['1'] },
      b: { imageIds: ['2'] },
    };
    const r = deleteCharacterAsset(before, 'a');
    expect(r.ok).toBe(true);
    expect(Object.keys(r.index)).toEqual(['b']);
  });

  test('idempotent on missing name (ok=true, returns same index reference)', () => {
    const before: CharacterAssetIndex = { a: { imageIds: ['1'] } };
    const r = deleteCharacterAsset(before, 'absent');
    expect(r.ok).toBe(true);
    expect(r.index).toBe(before);
  });

  test('does not mutate input', () => {
    const before: CharacterAssetIndex = { a: { imageIds: ['1'] } };
    const snap = JSON.stringify(before);
    deleteCharacterAsset(before, 'a');
    expect(JSON.stringify(before)).toBe(snap);
  });
});

// ─── Module path ────────────────────────────────────────────────────────

describe('addAssetToModuleIndex', () => {
  test('adds new entry on fresh name', () => {
    const r = addAssetToModuleIndex({}, 'sound', 'img-snd', 'mp3');
    expect(r.ok).toBe(true);
    expect(r.index['sound']).toEqual({ imageId: 'img-snd', ext: 'mp3' });
  });

  test('REPLACES existing entry on same name (single-source)', () => {
    const before: ModuleAssetIndex = { x: { imageId: 'old', ext: 'png' } };
    const r = addAssetToModuleIndex(before, 'x', 'new', 'webp');
    expect(r.ok).toBe(true);
    expect(r.index['x']).toEqual({ imageId: 'new', ext: 'webp' });
  });

  test('refuses empty name', () => {
    const r = addAssetToModuleIndex({}, '', 'img-1', undefined);
    expect(r.ok).toBe(false);
  });

  test('refuses empty imageId', () => {
    const r = addAssetToModuleIndex({}, 'name', '', undefined);
    expect(r.ok).toBe(false);
  });

  test('trims whitespace from name', () => {
    const r = addAssetToModuleIndex({}, '  trimmed  ', 'img-1', undefined);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.index)).toEqual(['trimmed']);
  });

  test('does not mutate input', () => {
    const before: ModuleAssetIndex = { x: { imageId: '1' } };
    const snap = JSON.stringify(before);
    addAssetToModuleIndex(before, 'y', '2', undefined);
    expect(JSON.stringify(before)).toBe(snap);
  });
});

describe('renameModuleAsset', () => {
  test('renames key', () => {
    const before: ModuleAssetIndex = { old: { imageId: 'x' } };
    const r = renameModuleAsset(before, 'old', 'new');
    expect(r.ok).toBe(true);
    expect(r.index).toEqual({ new: { imageId: 'x' } });
  });

  test('refuses on collision', () => {
    const before: ModuleAssetIndex = { a: { imageId: 'x' }, b: { imageId: 'y' } };
    const r = renameModuleAsset(before, 'a', 'b');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('already exists');
  });

  test('refuses when oldName missing', () => {
    const r = renameModuleAsset({}, 'nope', 'new');
    expect(r.ok).toBe(false);
  });

  test('refuses when newName empty/identical', () => {
    const before: ModuleAssetIndex = { x: { imageId: 'a' } };
    expect(renameModuleAsset(before, 'x', '   ').ok).toBe(false);
    expect(renameModuleAsset(before, 'x', 'x').ok).toBe(false);
  });

  test('preserves entry shape verbatim (incl. ext + bytes)', () => {
    const before: ModuleAssetIndex = {
      x: { imageId: 'img', ext: 'png', bytes: 1024 },
    };
    const r = renameModuleAsset(before, 'x', 'y');
    expect(r.ok).toBe(true);
    expect(r.index['y']).toEqual({ imageId: 'img', ext: 'png', bytes: 1024 });
  });
});

describe('deleteModuleAsset', () => {
  test('removes entry', () => {
    const before: ModuleAssetIndex = { a: { imageId: '1' } };
    const r = deleteModuleAsset(before, 'a');
    expect(r.ok).toBe(true);
    expect(r.index).toEqual({});
  });

  test('idempotent on missing', () => {
    const before: ModuleAssetIndex = { a: { imageId: '1' } };
    const r = deleteModuleAsset(before, 'nope');
    expect(r.ok).toBe(true);
    expect(r.index).toBe(before);
  });
});
