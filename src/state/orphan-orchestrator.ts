import type { OrphanAssetEntry, RepairScanSummary } from '../types/messages.js';
import type { SpindleAPI } from 'lumiverse-spindle-types';
import {
  buildLiveImageIdSet,
  type OrphanDetectDeps,
} from './orphan-detect.js';

export interface DeletedWhileOffReport {
  readonly characterIds: readonly string[];
  readonly moduleIds: readonly string[];
}

export interface OrphanScanReport {
  readonly orphans: readonly OrphanAssetEntry[];
  readonly summary: {
    readonly scannedTotal: number;
    readonly liveCharacterRefs: number;
    readonly liveModuleRefs: number;
    readonly liveJournalRefs: number;
    readonly charactersScanned: number;
    readonly modulesScanned: number;
    readonly elapsedMs: number;
    readonly totalOrphans: number;
    readonly truncated: boolean;
    readonly orphanRegexCleaned: number;
  };
}

export interface SpindleImageDTOLike {
  readonly id: string;
  readonly original_filename?: string;
  readonly mime_type?: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly url?: string;
  readonly owner_character_id?: string | null;
  readonly created_at?: number;
}

export interface ImagesListLike {
  readonly list: (
    options: { onlyOwned?: boolean; limit?: number; offset?: number; userId?: string },
  ) => Promise<{ data: readonly SpindleImageDTOLike[]; total: number }>;
}

export type RegexScriptsApiLike = Pick<SpindleAPI['regex_scripts'], 'list' | 'delete'>;

export interface JournalFileLike {
  readonly status: 'active' | 'pending_delete';
  readonly imageIds: readonly string[];
}

export interface OrphanOrchestratorDeps {
  readonly imagesApi: ImagesListLike;
  readonly regexApi: RegexScriptsApiLike;
  readonly listLumirealmCharacterIds: (userId: string) => Promise<readonly string[]>;
  readonly listModuleIds: (userId: string) => Promise<readonly string[]>;
  readonly characterExists: (userId: string, id: string) => Promise<boolean>;
  readonly moduleExists: (userId: string, id: string) => Promise<boolean>;
  readonly listImageJournalCharacterIds: (userId: string) => Promise<readonly string[]>;
  readonly readImageJournalFile: (userId: string, characterId: string) => Promise<JournalFileLike | null>;
  readonly listModuleImageJournalIds: (userId: string) => Promise<readonly string[]>;
  readonly readModuleImageJournalFile: (userId: string, moduleId: string) => Promise<JournalFileLike | null>;
  readonly clearImageJournal: (userId: string, characterId: string) => Promise<void>;
  readonly clearModuleImageJournal: (userId: string, moduleId: string) => Promise<void>;
  readonly buildOrphanDetectDeps: (userId: string) => OrphanDetectDeps;
  /** Backend-owned: counts derived from full lumirealm character + module
   *  envelope state (translator version, attached_module_ids vs live modules).
   *  Threaded as a callback so the orchestrator stays free of envelope semantics. */
  readonly countCharacterRepair: (userId: string) => Promise<{
    readonly charactersToRetranslate: number;
    readonly modulesToReattach: number;
    readonly danglingModuleRefs: number;
    readonly cardTargets: RepairScanSummary['cardTargets'];
    readonly moduleTargets: RepairScanSummary['moduleTargets'];
  }>;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface OrphanOrchestrator {
  detectDeletedWhileOff(userId: string): Promise<DeletedWhileOffReport>;
  scanOrphanedImages(userId: string): Promise<OrphanScanReport>;
  sweepOrphanModuleRegex(userId: string): Promise<number>;
  listStaleModuleRegexIds(userId: string): Promise<readonly string[]>;
  listStaleCharRegexIds(userId: string): Promise<readonly string[]>;
  deleteRegexIds(userId: string, ids: readonly string[]): Promise<number>;
  clearDeadJournals(userId: string): Promise<number>;
  scanRepairTargets(userId: string): Promise<RepairScanSummary>;
}

const PAGE_SIZE = 200;
const MAX_RETURNED_ORPHANS = 10_000;

export function createOrphanOrchestrator(
  deps: OrphanOrchestratorDeps,
): OrphanOrchestrator {
  async function detectDeletedWhileOff(userId: string): Promise<DeletedWhileOffReport> {
    const characterIds: string[] = [];
    const moduleIds: string[] = [];
    try {
      const charJournalIds = await deps.listImageJournalCharacterIds(userId);
      for (const characterId of charJournalIds) {
        const file = await deps.readImageJournalFile(userId, characterId);
        if (!file) continue;
        let exists = false;
        try {
          exists = await deps.characterExists(userId, characterId);
        } catch (err) {
          deps.log.warn(`detectDeletedWhileOff: characters.get(${characterId}) threw: ${deps.errMsg(err)}`);
          continue;
        }
        if (!exists) characterIds.push(characterId);
      }
    } catch (err) {
      deps.log.warn(`detectDeletedWhileOff: char-journal walk failed: ${deps.errMsg(err)}`);
    }
    try {
      const moduleJournalIds = await deps.listModuleImageJournalIds(userId);
      for (const moduleId of moduleJournalIds) {
        const file = await deps.readModuleImageJournalFile(userId, moduleId);
        if (!file) continue;
        // Inner try/catch mirrors the character side: a transient throw skips this entry instead of marking it deleted.
        let exists = false;
        try {
          exists = await deps.moduleExists(userId, moduleId);
        } catch (err) {
          deps.log.warn(`detectDeletedWhileOff: moduleExists(${moduleId}) threw: ${deps.errMsg(err)}`);
          continue;
        }
        if (!exists) moduleIds.push(moduleId);
      }
    } catch (err) {
      deps.log.warn(`detectDeletedWhileOff: module-journal walk failed: ${deps.errMsg(err)}`);
    }
    return { characterIds, moduleIds };
  }

  async function scanOrphanedImages(userId: string): Promise<OrphanScanReport> {
    const tStart = Date.now();
    const live = await buildLiveImageIdSet(deps.buildOrphanDetectDeps(userId));
    const ownedById = new Map<string, SpindleImageDTOLike>();
    let offset = 0;
    let pages = 0;
    while (true) {
      const page = await deps.imagesApi.list({
        onlyOwned: true,
        limit: PAGE_SIZE,
        offset,
        userId,
      });
      pages++;
      if (!page || !Array.isArray(page.data)) {
        deps.log.warn(`scanOrphanedImages: list returned bad shape pages=${pages}, stopping`);
        break;
      }
      if (page.data.length === 0) break;
      let added = 0;
      for (const img of page.data) {
        if (!img || typeof img.id !== 'string' || img.id.length === 0) continue;
        if (!ownedById.has(img.id)) {
          ownedById.set(img.id, img);
          added++;
        }
      }
      if (added === 0) {
        deps.log.warn(
          `scanOrphanedImages: page added 0 new IDs at offset=${offset} pages=${pages}, ` +
            `stopping (likely host returned dup-only page or ignored offset)`,
        );
        break;
      }
      offset += page.data.length;
      if (typeof page.total === 'number' && offset >= page.total) break;
    }

    const orphans: OrphanAssetEntry[] = [];
    for (const img of ownedById.values()) {
      if (live.liveIds.has(img.id)) continue;
      orphans.push({
        id: img.id,
        filename: typeof img.original_filename === 'string' ? img.original_filename : '',
        mime: typeof img.mime_type === 'string' ? img.mime_type : '',
        width: typeof img.width === 'number' ? img.width : null,
        height: typeof img.height === 'number' ? img.height : null,
        url: typeof img.url === 'string' ? img.url : '',
        ownerCharacterId: typeof img.owner_character_id === 'string' && img.owner_character_id.length > 0
          ? img.owner_character_id
          : null,
        createdAt: typeof img.created_at === 'number' ? img.created_at : 0,
      });
    }

    orphans.sort((a, b) => b.createdAt - a.createdAt);

    const totalOrphans = orphans.length;
    const truncated = totalOrphans > MAX_RETURNED_ORPHANS;
    const shown = truncated ? orphans.slice(0, MAX_RETURNED_ORPHANS) : orphans;

    const orphanRegexCleaned = await sweepOrphanModuleRegex(userId);

    return {
      orphans: shown,
      summary: {
        scannedTotal: ownedById.size,
        liveCharacterRefs: live.liveCharacterRefs,
        liveModuleRefs: live.liveModuleRefs,
        liveJournalRefs: live.liveJournalRefs,
        charactersScanned: live.charactersScanned,
        modulesScanned: live.modulesScanned,
        elapsedMs: Date.now() - tStart,
        totalOrphans,
        truncated,
        orphanRegexCleaned,
      },
    };
  }

  async function sweepOrphanModuleRegex(userId: string): Promise<number> {
    let liveModuleIds: Set<string>;
    try {
      const ids = await deps.listModuleIds(userId);
      liveModuleIds = new Set(ids);
    } catch (err) {
      deps.log.warn(`sweepOrphanModuleRegex: listModules failed: ${deps.errMsg(err)}`);
      return 0;
    }
    const orphanIds: string[] = [];
    let offset = 0;
    while (true) {
      let page: { data: readonly unknown[]; total: number };
      try {
        page = await deps.regexApi.list({ userId, limit: PAGE_SIZE, offset });
      } catch (err) {
        deps.log.warn(`sweepOrphanModuleRegex: regex_scripts.list offset=${offset} failed: ${deps.errMsg(err)}`);
        break;
      }
      if (!Array.isArray(page.data) || page.data.length === 0) break;
      for (const r of page.data) {
        const row = r as { id?: unknown; metadata?: { _risu?: { module_id?: unknown } } };
        const moduleId = row.metadata?._risu?.module_id;
        if (typeof moduleId !== 'string' || moduleId.length === 0) continue;
        if (liveModuleIds.has(moduleId)) continue;
        if (typeof row.id === 'string') orphanIds.push(row.id);
      }
      offset += page.data.length;
      if (typeof page.total === 'number' && offset >= page.total) break;
    }
    if (orphanIds.length === 0) {
      deps.log.info(`sweepOrphanModuleRegex: user=${userId} none orphaned`);
      return 0;
    }
    let deleted = 0;
    for (const id of orphanIds) {
      try {
        const ok = await deps.regexApi.delete(id, userId);
        if (ok) deleted++;
      } catch (err) {
        deps.log.warn(`sweepOrphanModuleRegex: delete id=${id} failed: ${deps.errMsg(err)}`);
      }
    }
    deps.log.info(`sweepOrphanModuleRegex: user=${userId} deleted ${deleted}/${orphanIds.length} orphan module regex`);
    return deleted;
  }

  async function listStaleModuleRegexIds(userId: string): Promise<readonly string[]> {
    let liveModuleIds: Set<string>;
    try {
      liveModuleIds = new Set(await deps.listModuleIds(userId));
    } catch (err) {
      deps.log.warn(`listStaleModuleRegexIds: listModules failed: ${deps.errMsg(err)}`);
      return [];
    }
    const orphanIds: string[] = [];
    let offset = 0;
    while (true) {
      let page: { data: readonly unknown[]; total: number };
      try {
        page = await deps.regexApi.list({ userId, limit: PAGE_SIZE, offset });
      } catch (err) {
        deps.log.warn(`listStaleModuleRegexIds: regex_scripts.list offset=${offset} failed: ${deps.errMsg(err)}`);
        break;
      }
      if (!Array.isArray(page.data) || page.data.length === 0) break;
      for (const raw of page.data) {
        const row = raw as {
          id?: unknown;
          metadata?: { _risu?: { module_id?: unknown; source_row_index?: unknown } };
        };
        const moduleId = row.metadata?._risu?.module_id;
        const sourceRowIndex = row.metadata?._risu?.source_row_index;
        if (
          typeof row.id !== 'string'
          || typeof moduleId !== 'string'
          || moduleId.length === 0
          || !Number.isInteger(sourceRowIndex)
        ) continue;
        if (!liveModuleIds.has(moduleId)) orphanIds.push(row.id);
      }
      offset += page.data.length;
      if (typeof page.total === 'number' && offset >= page.total) break;
    }
    return orphanIds;
  }

  async function listStaleCharRegexIds(userId: string): Promise<readonly string[]> {
    let liveCharIds: Set<string>;
    try {
      const ids = await deps.listLumirealmCharacterIds(userId);
      liveCharIds = new Set(ids);
    } catch (err) {
      deps.log.warn(`listStaleCharRegexIds: listLumirealmCharacters failed: ${deps.errMsg(err)}`);
      return [];
    }
    const orphanIds: string[] = [];
    let offset = 0;
    while (true) {
      let page: { data: readonly unknown[]; total: number };
      try {
        page = await deps.regexApi.list({ userId, limit: PAGE_SIZE, offset });
      } catch (err) {
        deps.log.warn(`listStaleCharRegexIds: regex_scripts.list offset=${offset} failed: ${deps.errMsg(err)}`);
        break;
      }
      if (!Array.isArray(page.data) || page.data.length === 0) break;
      for (const r of page.data) {
        const row = r as {
          id?: unknown;
          scope?: unknown;
          scope_id?: unknown;
          character_id?: unknown;
          metadata?: { _risu?: { module_id?: unknown; origin?: unknown } };
        };
        if (typeof row.id !== 'string') continue;
        if (row.scope !== 'character') continue;
        const risu = row.metadata?._risu;
        if (!risu || typeof risu !== 'object') continue;
        if (typeof (risu as { module_id?: unknown }).module_id === 'string') continue;
        const origin = (risu as { origin?: unknown }).origin;
        if (origin !== 'character' && origin !== 'module') continue;
        const charId = typeof row.scope_id === 'string'
          ? row.scope_id
          : typeof row.character_id === 'string'
            ? row.character_id
            : null;
        if (charId === null) continue;
        if (liveCharIds.has(charId)) continue;
        orphanIds.push(row.id);
      }
      offset += page.data.length;
      if (typeof page.total === 'number' && offset >= page.total) break;
    }
    return orphanIds;
  }

  async function deleteRegexIds(userId: string, ids: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      try {
        const ok = await deps.regexApi.delete(id, userId);
        if (ok) deleted++;
      } catch (err) {
        deps.log.warn(`deleteRegexIds: delete id=${id} failed: ${deps.errMsg(err)}`);
      }
    }
    return deleted;
  }

  async function clearDeadJournals(userId: string): Promise<number> {
    const detected = await detectDeletedWhileOff(userId);
    let cleared = 0;
    for (const characterId of detected.characterIds) {
      try {
        await deps.clearImageJournal(userId, characterId);
        cleared++;
      } catch (err) {
        deps.log.warn(`clearDeadJournals: clear character=${characterId} failed: ${deps.errMsg(err)}`);
      }
    }
    for (const moduleId of detected.moduleIds) {
      try {
        await deps.clearModuleImageJournal(userId, moduleId);
        cleared++;
      } catch (err) {
        deps.log.warn(`clearDeadJournals: clear module=${moduleId} failed: ${deps.errMsg(err)}`);
      }
    }
    deps.log.info(`clearDeadJournals: user=${userId} cleared ${cleared} dead journal(s)`);
    return cleared;
  }

  async function scanRepairTargets(userId: string): Promise<RepairScanSummary> {
    const t0 = Date.now();
    let staleModuleRegex = 0;
    try {
      const liveModuleIds = new Set(await deps.listModuleIds(userId));
      let offset = 0;
      while (true) {
        const page = await deps.regexApi.list({ userId, limit: PAGE_SIZE, offset });
        if (!Array.isArray(page.data) || page.data.length === 0) break;
        for (const r of page.data) {
          const row = r as { metadata?: { _risu?: { module_id?: unknown } } };
          const moduleId = row.metadata?._risu?.module_id;
          if (typeof moduleId !== 'string' || moduleId.length === 0) continue;
          if (!liveModuleIds.has(moduleId)) staleModuleRegex++;
        }
        offset += page.data.length;
        if (typeof page.total === 'number' && offset >= page.total) break;
      }
    } catch (err) {
      deps.log.warn(`scanRepairTargets: stale module regex count failed: ${deps.errMsg(err)}`);
    }
    let staleCharRegex = 0;
    try {
      staleCharRegex = (await listStaleCharRegexIds(userId)).length;
    } catch (err) {
      deps.log.warn(`scanRepairTargets: stale char regex count failed: ${deps.errMsg(err)}`);
    }
    let deadJournals = 0;
    try {
      const detected = await detectDeletedWhileOff(userId);
      deadJournals = detected.characterIds.length + detected.moduleIds.length;
    } catch (err) {
      deps.log.warn(`scanRepairTargets: dead journal count failed: ${deps.errMsg(err)}`);
    }
    let charCounts: Pick<
      RepairScanSummary,
      'charactersToRetranslate' | 'modulesToReattach' | 'danglingModuleRefs' | 'cardTargets' | 'moduleTargets'
    > = {
      charactersToRetranslate: 0,
      modulesToReattach: 0,
      danglingModuleRefs: 0,
      cardTargets: [],
      moduleTargets: [],
    };
    try {
      charCounts = await deps.countCharacterRepair(userId);
    } catch (err) {
      deps.log.warn(`scanRepairTargets: char/module count failed: ${deps.errMsg(err)}`);
    }
    return {
      staleModuleRegex,
      staleCharRegex,
      deadJournals,
      ...charCounts,
      elapsedMs: Date.now() - t0,
    };
  }

  return {
    detectDeletedWhileOff,
    scanOrphanedImages,
    sweepOrphanModuleRegex,
    listStaleModuleRegexIds,
    listStaleCharRegexIds,
    deleteRegexIds,
    clearDeadJournals,
    scanRepairTargets,
  };
}
