import { describe, it, expect } from 'bun:test';
import {
  buildLiveImageIdSet,
  extractImageUrlIds,
  type CharacterRecordView,
  type ModuleRecordView,
  type OrphanDetectDeps,
} from '../../src/state/orphan-detect.js';
import type { ImageJournalFile } from '../../src/state/image-journal.js';
import type { ModuleImageJournalFile } from '../../src/state/module-image-journal.js';

interface FixtureInput {
  characters?: readonly CharacterRecordView[];
  modules?: readonly ModuleRecordView[];
  characterJournals?: readonly ImageJournalFile[];
  moduleJournals?: readonly ModuleImageJournalFile[];
  /** IDs that characterExists() returns true for. Defaults to every journal owner. */
  existingCharacterIds?: readonly string[];
  existingModuleIds?: readonly string[];
}

function makeDeps(input: FixtureInput): OrphanDetectDeps {
  const characters = input.characters ?? [];
  const modules = input.modules ?? [];
  const charJournals = input.characterJournals ?? [];
  const modJournals = input.moduleJournals ?? [];
  const existingChars = new Set(
    input.existingCharacterIds ?? charJournals.map((j) => j.characterId),
  );
  const existingMods = new Set(
    input.existingModuleIds ?? modJournals.map((j) => j.moduleId),
  );
  return {
    listLumirealmCharacters: async () => characters,
    listModules: async () => modules,
    listActiveCharacterJournals: async () => charJournals,
    listActiveModuleJournals: async () => modJournals,
    characterExists: async (id) => existingChars.has(id),
    moduleExists: async (id) => existingMods.has(id),
  };
}

function journal(characterId: string, imageIds: readonly string[]): ImageJournalFile {
  return {
    schema_version: 1,
    characterId,
    imageIds,
    status: 'active',
    updated_at: 0,
  };
}

function moduleJournal(moduleId: string, imageIds: readonly string[]): ModuleImageJournalFile {
  return {
    schema_version: 1,
    moduleId,
    imageIds,
    status: 'active',
    updated_at: 0,
  };
}

describe('extractImageUrlIds', () => {
  it('extracts ID from /api/v1/images/<id> URL', () => {
    expect(extractImageUrlIds('<img src="/api/v1/images/abc-123"/>')).toEqual(['abc-123']);
  });

  it('extracts multiple IDs from one body', () => {
    const html = `<img src="/api/v1/images/aaa"/> and <img src="/api/v1/images/bbb-2"/>`;
    expect(extractImageUrlIds(html)).toEqual(['aaa', 'bbb-2']);
  });

  it('returns empty for null/empty/non-string', () => {
    expect(extractImageUrlIds(null)).toEqual([]);
    expect(extractImageUrlIds('')).toEqual([]);
    expect(extractImageUrlIds(undefined)).toEqual([]);
  });

  it('does not match unrelated URLs', () => {
    expect(extractImageUrlIds('<a href="/api/v1/characters/x">x</a>')).toEqual([]);
  });
});

describe('buildLiveImageIdSet', () => {
  it('shields character avatar + asset_index + emotion_index IDs', async () => {
    const deps = makeDeps({
      characters: [
        {
          id: 'char-1',
          image_id: 'avatar-1',
          asset_index: { foo: { imageIds: ['asset-a', 'asset-b'] } },
          emotion_index: { happy: { imageIds: ['emotion-1'] } },
        },
      ],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['avatar-1', 'asset-a', 'asset-b', 'emotion-1']));
    expect(r.liveCharacterRefs).toBe(4);
    expect(r.liveJournalRefs).toBe(0);
    expect(r.charactersScanned).toBe(1);
  });

  it('shields module asset_index IDs', async () => {
    const deps = makeDeps({
      modules: [{ id: 'mod-1', asset_imageIds: ['m-1', 'm-2'] }],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['m-1', 'm-2']));
    expect(r.liveModuleRefs).toBe(2);
    expect(r.modulesScanned).toBe(1);
  });

  it('extracts image IDs from regex_scripts.replace_string URLs', async () => {
    const deps = makeDeps({
      characters: [
        {
          id: 'char-1',
          regex_replace_strings: [
            '<div><img src="/api/v1/images/svg-raster-1"/></div>',
            'inline <img src="/api/v1/images/svg-raster-2"/> here',
          ],
        },
      ],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.has('svg-raster-1')).toBe(true);
    expect(r.liveIds.has('svg-raster-2')).toBe(true);
  });

  it('extracts image IDs from background_html URLs', async () => {
    const deps = makeDeps({
      characters: [
        {
          id: 'char-1',
          background_html: '<style>body{background:url("/api/v1/images/bg-id-1")}</style>',
        },
      ],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.has('bg-id-1')).toBe(true);
  });

  it('shields journal IDs when owning character STILL EXISTS', async () => {
    const deps = makeDeps({
      characterJournals: [journal('char-1', ['j-1', 'j-2', 'j-3'])],
      existingCharacterIds: ['char-1'],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['j-1', 'j-2', 'j-3']));
    expect(r.liveJournalRefs).toBe(3);
    expect(r.skippedJournalCharacters).toEqual([]);
  });

  // Repro of the deleted-while-off bug. Old code shielded these IDs and
  // reported zero orphans on a library full of ghost references.
  it('does NOT shield journal IDs when owning character is GONE (deleted-while-off)', async () => {
    const deps = makeDeps({
      characterJournals: [journal('deleted-char', ['ghost-1', 'ghost-2', 'ghost-3'])],
      existingCharacterIds: [],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.size).toBe(0);
    expect(r.liveJournalRefs).toBe(0);
    expect(r.skippedJournalCharacters).toEqual(['deleted-char']);
  });

  it('does NOT shield module-journal IDs when envelope is gone', async () => {
    const deps = makeDeps({
      moduleJournals: [moduleJournal('deleted-mod', ['ghost-m-1', 'ghost-m-2'])],
      existingModuleIds: [],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.size).toBe(0);
    expect(r.liveJournalRefs).toBe(0);
    expect(r.skippedJournalModules).toEqual(['deleted-mod']);
  });

  it('mixed: live character shields some IDs, dead-character journal does not', async () => {
    const deps = makeDeps({
      characters: [
        { id: 'live-char', asset_index: { x: { imageIds: ['live-1', 'live-2'] } } },
      ],
      characterJournals: [
        journal('live-char', ['live-1']),
        journal('deleted-char', ['ghost-1', 'ghost-2']),
      ],
      existingCharacterIds: ['live-char'],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['live-1', 'live-2']));
    expect(r.liveIds.has('ghost-1')).toBe(false);
    expect(r.liveIds.has('ghost-2')).toBe(false);
    expect(r.skippedJournalCharacters).toEqual(['deleted-char']);
  });

  it('dedups across sources (same ID counted once)', async () => {
    const deps = makeDeps({
      characters: [
        { id: 'c1', image_id: 'shared-1', asset_index: { x: { imageIds: ['shared-1'] } } },
      ],
      characterJournals: [journal('c1', ['shared-1'])],
      existingCharacterIds: ['c1'],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['shared-1']));
    expect(r.liveCharacterRefs + r.liveJournalRefs).toBe(1);
  });

  it('rejects empty / non-string IDs', async () => {
    const deps = makeDeps({
      characters: [
        {
          id: 'c1',
          image_id: '',
          asset_index: { x: { imageIds: ['', 'real-id', null as unknown as string] } },
        },
      ],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(['real-id']));
  });

  // Lumi-side duplicate deep-copies extensions verbatim, so both characters
  // reference the same image IDs. Deleting the original while extension off
  // leaves an orphaned journal, but the duplicate's extensions still shield.
  it('handles duplicated-card scenario: surviving duplicate shields, dead-original journal does not', async () => {
    const sharedIds = ['shared-img-1', 'shared-img-2'];
    const deps = makeDeps({
      characters: [
        { id: 'a2', asset_index: { x: { imageIds: sharedIds } } },
      ],
      characterJournals: [
        journal('a-deleted', sharedIds),
      ],
      existingCharacterIds: ['a2'],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds).toEqual(new Set(sharedIds));
    expect(r.skippedJournalCharacters).toEqual(['a-deleted']);
  });
});

// Module-delete uses buildLiveImageIdSet AFTER removing the target envelope to
// figure out which of the target's journal IDs are safe to delete. Other live
// modules / characters that happen to reference the same IDs must shield them.
describe('buildLiveImageIdSet for module-delete safety (post-envelope-removal scan)', () => {
  it('returns empty live set when only the target module existed', async () => {
    const targetIds = ['mod-img-1', 'mod-img-2', 'mod-img-3'];
    const deps = makeDeps({
      modules: [],
      moduleJournals: [moduleJournal('target-mod', targetIds)],
      existingModuleIds: [],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.size).toBe(0);
    const safeToDelete = targetIds.filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual(targetIds);
  });

  it('shields IDs that another live module ALSO references', async () => {
    const sharedIds = ['shared-mod-img-1', 'shared-mod-img-2'];
    const targetOnlyIds = ['target-only-1'];
    const deps = makeDeps({
      modules: [
        { id: 'other-mod', asset_imageIds: sharedIds },
      ],
      moduleJournals: [
        moduleJournal('target-mod', [...sharedIds, ...targetOnlyIds]),
      ],
      existingModuleIds: ['other-mod'],
    });
    const r = await buildLiveImageIdSet(deps);
    const journalIds = [...sharedIds, ...targetOnlyIds];
    const safeToDelete = journalIds.filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual(targetOnlyIds);
    expect(r.liveIds).toEqual(new Set(sharedIds));
  });

  it('shields IDs that a live character references via asset_index', async () => {
    const moduleId = 'tgt';
    const characterId = 'char-still-uses-it';
    const sharedId = 'cross-referenced-img';
    const moduleOnly = 'module-only-img';
    const deps = makeDeps({
      characters: [
        { id: characterId, asset_index: { foo: { imageIds: [sharedId] } } },
      ],
      modules: [],
      moduleJournals: [moduleJournal(moduleId, [sharedId, moduleOnly])],
      existingModuleIds: [],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.has(sharedId)).toBe(true);
    expect(r.liveIds.has(moduleOnly)).toBe(false);
    const safeToDelete = [sharedId, moduleOnly].filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual([moduleOnly]);
  });

  // Lumi's CHARACTER_DELETED event fires BEFORE the character row is removed,
  // so listLumirealmCharacters still returns the about-to-be-deleted character.
  // Auto-cleanup must explicitly exclude that ID, otherwise the doomed
  // character's asset_index shields its own image IDs from cleanup.
  it('CHARACTER_DELETED scenario: excluding the deleted character lets its IDs be cleaned', async () => {
    const deletedId = 'deleted-char';
    const deletedAssetIds = ['del-img-1', 'del-img-2'];
    const survivorId = 'survivor';
    const survivorAssetIds = ['surv-img-1'];
    const baseDeps: OrphanDetectDeps = {
      listLumirealmCharacters: async () => [
        { id: deletedId, asset_index: { x: { imageIds: deletedAssetIds } } },
        { id: survivorId, asset_index: { y: { imageIds: survivorAssetIds } } },
      ],
      listModules: async () => [],
      listActiveCharacterJournals: async () => [journal(deletedId, deletedAssetIds)],
      listActiveModuleJournals: async () => [],
      characterExists: async (id) => id === deletedId || id === survivorId,
      moduleExists: async () => false,
    };
    // Caller wraps the deps to exclude the about-to-be-deleted character.
    const excludingDeps: OrphanDetectDeps = {
      ...baseDeps,
      listLumirealmCharacters: async () => {
        const all = await baseDeps.listLumirealmCharacters();
        return all.filter((c) => c.id !== deletedId);
      },
      characterExists: async (id) => {
        if (id === deletedId) return false;
        return baseDeps.characterExists(id);
      },
    };
    const r = await buildLiveImageIdSet(excludingDeps);
    expect(r.liveIds).toEqual(new Set(survivorAssetIds));
    const safeToDelete = deletedAssetIds.filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual(deletedAssetIds);
  });

  // Duplicate-character scenario via Lumi's deep-copy: deleting the original
  // must NOT delete shared image IDs because the duplicate references them.
  it('CHARACTER_DELETED with surviving duplicate: shared IDs are shielded', async () => {
    const deletedId = 'original';
    const duplicateId = 'duplicate';
    const sharedIds = ['shared-img-1', 'shared-img-2'];
    const uniqueToOriginal = ['unique-orig-1'];
    const baseDeps: OrphanDetectDeps = {
      listLumirealmCharacters: async () => [
        { id: deletedId, asset_index: { a: { imageIds: [...sharedIds, ...uniqueToOriginal] } } },
        { id: duplicateId, asset_index: { a: { imageIds: sharedIds } } },
      ],
      listModules: async () => [],
      listActiveCharacterJournals: async () => [
        journal(deletedId, [...sharedIds, ...uniqueToOriginal]),
      ],
      listActiveModuleJournals: async () => [],
      characterExists: async (id) => id === deletedId || id === duplicateId,
      moduleExists: async () => false,
    };
    const excludingDeps: OrphanDetectDeps = {
      ...baseDeps,
      listLumirealmCharacters: async () => {
        const all = await baseDeps.listLumirealmCharacters();
        return all.filter((c) => c.id !== deletedId);
      },
      characterExists: async (id) => {
        if (id === deletedId) return false;
        return baseDeps.characterExists(id);
      },
    };
    const r = await buildLiveImageIdSet(excludingDeps);
    expect(r.liveIds).toEqual(new Set(sharedIds));
    const journalIds = [...sharedIds, ...uniqueToOriginal];
    const safeToDelete = journalIds.filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual(uniqueToOriginal);
  });

  it('handles re-uploaded module with stale journal IDs', async () => {
    // Re-upload appends new IDs to the journal, leaving stale v1 IDs that the
    // current envelope no longer references. After envelope removal, both v1
    // and v2 IDs must be safe to delete, the live set shouldn't shield v1
    // (no live thing references them anymore).
    const v1Ids = ['v1-a', 'v1-b'];
    const v2Ids = ['v2-c', 'v2-d'];
    const deps = makeDeps({
      modules: [],
      moduleJournals: [moduleJournal('m', [...v1Ids, ...v2Ids])],
      existingModuleIds: [],
    });
    const r = await buildLiveImageIdSet(deps);
    expect(r.liveIds.size).toBe(0);
    const safeToDelete = [...v1Ids, ...v2Ids].filter((id) => !r.liveIds.has(id));
    expect(safeToDelete).toEqual([...v1Ids, ...v2Ids]);
  });
});
