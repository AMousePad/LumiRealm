declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { AssetIndexEntry } from '../payload/types.js';
import type { OrphanDetectDeps } from './orphan-detect.js';
import type { JournalStorage, ImageJournalFile } from './image-journal.js';
import type { ModuleEnvelope, ModuleIndexEntry } from './modules-store.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import {
  appendImageIdsToJournal,
  listImageJournalCharacterIds,
  readImageJournalFile,
} from './image-journal.js';
import {
  listModuleImageJournalIds,
  readModuleImageJournalFile,
} from './module-image-journal.js';

export function collectStoredCardImageIds(
  avatarId: string | null,
  card: { asset_index: Readonly<Record<string, AssetIndexEntry>>; emotion_index: Readonly<Record<string, AssetIndexEntry>> },
): readonly string[] {
  const ids: string[] = [];
  if (typeof avatarId === 'string' && avatarId.length > 0) ids.push(avatarId);
  const collect = (idx: Readonly<Record<string, AssetIndexEntry>>): void => {
    for (const entry of Object.values(idx)) {
      for (const id of entry.imageIds) {
        if (typeof id === 'string' && id.length > 0) ids.push(id);
      }
    }
  };
  collect(card.asset_index);
  collect(card.emotion_index);
  return ids;
}

export interface OrphanDetectBuildersDeps {
  readonly journalStorage: () => JournalStorage;
  readonly listLumirealmCharacters: (userId: string) => Promise<readonly {
    readonly character: { readonly id: string; readonly image_id?: string | null };
    readonly data: LumirealmCharacterData;
  }[]>;
  readonly listModuleStore: (userId: string) => Promise<readonly ModuleIndexEntry[]>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface OrphanDetectBuilders {
  readonly buildOrphanDetectDeps: (userId: string) => OrphanDetectDeps;
  readonly buildOrphanDetectDepsExcluding: (
    userId: string,
    excludeCharacterId: string,
  ) => OrphanDetectDeps;
  readonly backfillImageJournalIfMissing: (
    characterId: string,
    avatarId: string | null,
    card: { asset_index: Readonly<Record<string, AssetIndexEntry>>; emotion_index: Readonly<Record<string, AssetIndexEntry>> },
    userId: string,
  ) => Promise<void>;
  readonly deleteImageIds: (
    imageIds: readonly string[],
    userId: string,
    context: string,
    onProgress?: (processed: number, total: number) => void,
  ) => Promise<{ deleted: number; absent: number; failed: number }>;
}

function spindleImagesDelete(): ((id: string, userId?: string) => Promise<boolean>) | null {
  return spindle.images?.delete ? spindle.images.delete.bind(spindle.images) : null;
}

function spindleImagesDeleteMany(): ((ids: string[], opts: { userId?: string }) => Promise<number>) | null {
  const api = spindle.images as unknown as {
    deleteMany?: (ids: string[], opts: { userId?: string }) => Promise<number>;
  } | undefined;
  return typeof api?.deleteMany === 'function' ? api.deleteMany.bind(spindle.images) : null;
}

export function createOrphanDetectBuilders(deps: OrphanDetectBuildersDeps): OrphanDetectBuilders {
  const {
    journalStorage,
    listLumirealmCharacters,
    listModuleStore,
    readModuleEnvelope,
    log,
    errMsg,
  } = deps;

  function buildOrphanDetectDeps(userId: string): OrphanDetectDeps {
    return {
      listLumirealmCharacters: async () => {
        const entries = await listLumirealmCharacters(userId);
        return entries.map(({ character, data }) => ({
          id: character.id,
          image_id: character.image_id ?? null,
          asset_index: data.asset_index,
          emotion_index: data.emotion_index,
          regex_replace_strings: data.regex_scripts.map((r) => r.replace_string),
          background_html: data.payload?.background_html ?? null,
        }));
      },
      listModules: async () => {
        const summaries = await listModuleStore(userId);
        const out: Array<{ id: string; asset_imageIds: readonly string[] }> = [];
        for (const summary of summaries) {
          const env = await readModuleEnvelope(userId, summary.id);
          if (!env) continue;
          const ids: string[] = [];
          for (const ref of Object.values(env.asset_index ?? {})) {
            if (typeof ref.imageId === 'string' && ref.imageId.length > 0) {
              ids.push(ref.imageId);
            }
          }
          out.push({ id: summary.id, asset_imageIds: ids });
        }
        return out;
      },
      listActiveCharacterJournals: async () => {
        const ids = await listImageJournalCharacterIds(journalStorage(), userId);
        const out: ImageJournalFile[] = [];
        for (const id of ids) {
          const f = await readImageJournalFile(journalStorage(), userId, id);
          if (f && f.status === 'active') out.push(f);
        }
        return out;
      },
      listActiveModuleJournals: async () => {
        const ids = await listModuleImageJournalIds(journalStorage(), userId);
        const out: NonNullable<Awaited<ReturnType<typeof readModuleImageJournalFile>>>[] = [];
        for (const id of ids) {
          const f = await readModuleImageJournalFile(journalStorage(), userId, id);
          if (f && f.status === 'active') out.push(f);
        }
        return out;
      },
      // Throws propagate. Callers decide what a transient error means: buildLiveImageIdSet treats throw as absent (matches pre-refactor scan semantic), detectDeletedWhileOff treats throw as skip-entry so a network blip doesn't prompt cleanup of live data.
      characterExists: async (id) => {
        const c = await spindle.characters.get(id, userId);
        return c !== null;
      },
      moduleExists: async (id) => {
        const env = await readModuleEnvelope(userId, id);
        return env !== null;
      },
    };
  }

  // Wraps buildOrphanDetectDeps to treat one character as already-removed. Used by CHARACTER_DELETED, where Lumi fires the event before the row is removed.
  function buildOrphanDetectDepsExcluding(
    userId: string,
    excludeCharacterId: string,
  ): OrphanDetectDeps {
    const base = buildOrphanDetectDeps(userId);
    return {
      ...base,
      listLumirealmCharacters: async () => {
        const all = await base.listLumirealmCharacters();
        return all.filter((c) => c.id !== excludeCharacterId);
      },
      characterExists: async (id) => {
        if (id === excludeCharacterId) return false;
        return base.characterExists(id);
      },
    };
  }

  async function backfillImageJournalIfMissing(
    characterId: string,
    avatarId: string | null,
    card: { asset_index: Readonly<Record<string, AssetIndexEntry>>; emotion_index: Readonly<Record<string, AssetIndexEntry>> },
    userId: string,
  ): Promise<void> {
    try {
      const existing = await readImageJournalFile(journalStorage(), userId, characterId);
      if (existing) return;
      const ids = collectStoredCardImageIds(avatarId, card);
      if (ids.length === 0) return;
      await appendImageIdsToJournal(journalStorage(), userId, characterId, ids);
      log.info(
        `image-journal: backfilled legacy char=${characterId} ids=${ids.length}`,
      );
    } catch (err) {
      log.warn(`image-journal: backfill failed char=${characterId}: ${errMsg(err)}`);
    }
  }

  async function deleteImageIds(
    imageIds: readonly string[],
    userId: string,
    context: string,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ deleted: number; absent: number; failed: number }> {
    let deleted = 0;
    let absent = 0;
    let failed = 0;
    const delMany = spindleImagesDeleteMany();
    if (delMany && imageIds.length > 1) {
      const BATCH = 500;
      const total = imageIds.length;
      let processed = 0;
      for (let i = 0; i < total; i += BATCH) {
        const batch = imageIds.slice(i, i + BATCH).filter((id) => typeof id === 'string' && id.length > 0);
        try {
          deleted += await delMany([...batch], { userId });
        } catch (err) {
          failed += batch.length;
          log.warn(`${context}: bulk image delete threw (${batch.length} ids): ${errMsg(err)}`);
        }
        processed = Math.min(i + BATCH, total);
        if (onProgress) {
          try { onProgress(processed, total); } catch (err) { log.warn(`${context}: onProgress threw: ${errMsg(err)}`); }
        }
      }
      absent = Math.max(0, total - deleted - failed);
      return { deleted, absent, failed };
    }
    const del = spindleImagesDelete();
    if (!del) {
      log.warn(`${context}: spindle.images.delete unavailable,${imageIds.length} image(s) leaked`);
      return { deleted, absent, failed: imageIds.length };
    }
    let nextIndex = 0;
    let processed = 0;
    const total = imageIds.length;
    const concurrency = Math.min(6, total);
    // Throttle progress emission so 10k-image deletes don't spam WS at 6Hz.
    const progressEvery = Math.max(10, Math.floor(total / 100));
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= total) break;
        const id = imageIds[i];
        if (!id) {
          processed++;
          continue;
        }
        try {
          const ok = await del(id, userId);
          if (ok) deleted++; else absent++;
        } catch (err) {
          failed++;
          log.warn(`${context}: image delete threw id=${id}: ${errMsg(err)}`);
        }
        processed++;
        if (onProgress && (processed % progressEvery === 0 || processed === total)) {
          try {
            onProgress(processed, total);
          } catch (err) {
            log.warn(`${context}: onProgress threw: ${errMsg(err)}`);
          }
        }
      }
    };
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    return { deleted, absent, failed };
  }

  return {
    buildOrphanDetectDeps,
    buildOrphanDetectDepsExcluding,
    backfillImageJournalIfMissing,
    deleteImageIds,
  };
}
