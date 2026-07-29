declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type {
  AssetIndexEntry,
  LumirealmCharacterData,
} from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';
import type { FrontendToBackend } from '../types/messages.js';
import {
  addAssetToCharacterIndex,
  addAssetToModuleIndex,
  deleteCharacterAsset,
  deleteModuleAsset,
  renameCharacterAsset,
  renameModuleAsset,
} from './asset-index-mutate.js';
import {
  extractLuaForTrigger,
  replaceTriggerLuaInArray,
} from './trigger-lua-mutate.js';
import { expectCharacterEdit } from './own-character-edit.js';

function assetStem(name: string): string {
  const base = name.split('/').pop() || name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function setMapKey(map: Record<string, string>, name: string, id: string): void {
  if (!id) return;
  map[name] = id;
  const stem = assetStem(name);
  if (stem !== name && !(stem in map)) map[stem] = id;
}

export type AssetMutationMessage =
  | Extract<FrontendToBackend, { type: 'add_assets' }>
  | Extract<FrontendToBackend, { type: 'rename_asset' }>
  | Extract<FrontendToBackend, { type: 'delete_assets' }>;

export interface AssetMutationResultStats {
  readonly ok: boolean;
  readonly reason?: string;
  /** delete_assets only. Entries actually present and removed. */
  readonly removed?: number;
  readonly imagesDeleted?: number;
  /** Image ids kept because something else still references them. */
  readonly imagesShielded?: number;
}

export interface AssetTriggerMutateDeps {
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<{ data: LumirealmCharacterData | null } | null>;
  readonly updateLumirealm: (
    characterId: string,
    userId: string,
    fn: (cur: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly writeModuleEnvelope: (userId: string, env: ModuleEnvelope) => Promise<void>;
  readonly pushModules: (userId: string) => Promise<void>;
  // Reclaim pass for delete_assets. Must run after the envelope write: the live
  // sweep reads the card's own index, so a pre-write call shields every id and
  // silently deletes nothing.
  readonly reclaimImageIds: (
    imageIds: readonly string[],
    userId: string,
    context: string,
  ) => Promise<{ deleted: number; shielded: number }>;
  readonly log: { readonly warn: (m: string) => void; readonly trace: (m: string) => void; readonly info: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface AssetTriggerMutate {
  readonly refreshRisuAssetMap: (characterId: string, userId: string) => Promise<void>;
  readonly mutateAssetIndex: (msg: AssetMutationMessage, userId: string) => Promise<AssetMutationResultStats>;
  readonly mutateTriggerLua: (
    msg: Extract<FrontendToBackend, { type: 'set_trigger_lua' }>,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
}

export function createAssetTriggerMutate(deps: AssetTriggerMutateDeps): AssetTriggerMutate {
  const {
    readLumirealm,
    updateLumirealm,
    readModuleEnvelope,
    writeModuleEnvelope,
    pushModules,
    reclaimImageIds,
    log,
    errMsg,
  } = deps;

  async function reclaim(
    imageIds: readonly string[],
    userId: string,
    context: string,
  ): Promise<{ imagesDeleted: number; imagesShielded: number }> {
    const unique = [...new Set(imageIds)];
    if (unique.length === 0) return { imagesDeleted: 0, imagesShielded: 0 };
    try {
      const r = await reclaimImageIds(unique, userId, context);
      log.info(
        `${context}: reclaimed ${r.deleted}/${unique.length} image(s), ${r.shielded} still referenced`,
      );
      return { imagesDeleted: r.deleted, imagesShielded: r.shielded };
    } catch (err) {
      // Index entries are already gone. A failed reclaim leaves orphans that
      // Settings -> Cleanup collects, so don't fail the whole mutation.
      log.warn(`${context}: image reclaim failed, ${unique.length} id(s) left for Cleanup: ${errMsg(err)}`);
      return { imagesDeleted: 0, imagesShielded: 0 };
    }
  }

  async function refreshRisuAssetMap(characterId: string, userId: string): Promise<void> {
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched || !fetched.data) return;
    const data = fetched.data;
    const map: Record<string, string> = {};
    const moduleIds = data.user_overrides.attached_module_ids ?? [];
    for (const modId of moduleIds) {
      const env = await readModuleEnvelope(userId, modId);
      if (!env) continue;
      for (const [name, ref] of Object.entries(env.asset_index)) {
        if (typeof ref?.imageId === 'string' && ref.imageId.length > 0) {
          setMapKey(map, name, ref.imageId);
        }
      }
    }
    for (const [name, entry] of Object.entries(data.asset_index)) {
      const id = (entry as AssetIndexEntry).imageIds[0];
      if (typeof id === 'string' && id.length > 0) setMapKey(map, name, id);
    }
    for (const [name, entry] of Object.entries(data.emotion_index)) {
      const id = (entry as AssetIndexEntry).imageIds[0];
      if (typeof id === 'string' && id.length > 0) setMapKey(map, name, id);
    }
    expectCharacterEdit(characterId);
    try {
      await spindle.characters.update(
        characterId,
        { extensions: { risu_asset_map: map } } as never,
        userId,
      );
      const ids = Object.values(map);
      const dist: Record<string, number> = {};
      for (const id of ids) dist[id] = (dist[id] ?? 0) + 1;
      const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 3);
      log.trace(
        `refreshRisuAssetMap: char=${characterId} entries=${ids.length} ` +
          `unique_image_ids=${new Set(ids).size} ` +
          `top3=${top.map(([id, n]) => `${id.slice(0, 8)}…(${n})`).join(',')}`,
      );
    } catch (err) {
      log.warn(`refreshRisuAssetMap: char=${characterId} update failed: ${errMsg(err)}`);
    }
  }

  async function mutateAssetIndex(
    msg: AssetMutationMessage,
    userId: string,
  ): Promise<AssetMutationResultStats> {
    if (msg.source.kind === 'character') {
      const characterId = msg.source.characterId;
      // updateLumirealm may re-invoke on write contention, so these are assigned
      // per attempt rather than accumulated.
      let removedIds: string[] = [];
      let removedCount = 0;
      const updated = await updateLumirealm(characterId, userId, (cur) => {
        const before = cur.asset_index;
        if (msg.type === 'add_assets') {
          let working = before;
          for (const e of msg.entries) {
            const r = addAssetToCharacterIndex(working, e.assetName, e.imageId, e.ext);
            if (r.ok) working = r.index;
            else log.warn(`add_assets (character ${characterId}): "${e.assetName}" skipped,${r.reason}`);
          }
          return { ...cur, asset_index: working };
        }
        if (msg.type === 'delete_assets') {
          let working = before;
          const ids: string[] = [];
          let removed = 0;
          for (const name of msg.assetNames) {
            // deleteCharacterAsset is idempotent, so absence can't be read off
            // its result. Look first to collect ids and count real removals.
            const entry = Object.prototype.hasOwnProperty.call(working, name)
              ? working[name]
              : undefined;
            const r = deleteCharacterAsset(working, name);
            if (!r.ok) {
              log.warn(`delete_assets (character ${characterId}): "${name}" skipped,${r.reason}`);
              continue;
            }
            working = r.index;
            if (entry) {
              removed++;
              for (const id of entry.imageIds) {
                if (typeof id === 'string' && id.length > 0) ids.push(id);
              }
            }
          }
          removedIds = ids;
          removedCount = removed;
          return { ...cur, asset_index: working };
        }
        const result = renameCharacterAsset(before, msg.oldName, msg.newName);
        if (!result.ok) {
          log.warn(
            `mutateAssetIndex (character ${characterId}): ${msg.type} failed,${result.reason}`,
          );
          return cur;
        }
        return { ...cur, asset_index: result.index };
      });
      if (!updated) return { ok: false, reason: 'character is not a lumirealm card' };
      if (msg.type === 'delete_assets') {
        const stats = await reclaim(removedIds, userId, `delete_assets(character ${characterId})`);
        return { ok: true, removed: removedCount, ...stats };
      }
      return { ok: true };
    }

    const moduleId = msg.source.moduleId;
    const env = await readModuleEnvelope(userId, moduleId);
    if (!env) return { ok: false, reason: `module ${moduleId} not in library` };
    if (msg.type === 'add_assets') {
      let working = env.asset_index;
      for (const e of msg.entries) {
        const r = addAssetToModuleIndex(working, e.assetName, e.imageId, e.ext);
        if (r.ok) working = r.index;
        else log.warn(`add_assets (module ${moduleId}): "${e.assetName}" skipped,${r.reason}`);
      }
      const nextEnv = { ...env, asset_index: working };
      await writeModuleEnvelope(userId, nextEnv);
      await pushModules(userId);
      return { ok: true };
    }
    if (msg.type === 'delete_assets') {
      let working = env.asset_index;
      const ids: string[] = [];
      let removed = 0;
      for (const name of msg.assetNames) {
        const ref = Object.prototype.hasOwnProperty.call(working, name)
          ? working[name]
          : undefined;
        const r = deleteModuleAsset(working, name);
        if (!r.ok) {
          log.warn(`delete_assets (module ${moduleId}): "${name}" skipped,${r.reason}`);
          continue;
        }
        working = r.index;
        if (ref) {
          removed++;
          if (typeof ref.imageId === 'string' && ref.imageId.length > 0) ids.push(ref.imageId);
        }
      }
      await writeModuleEnvelope(userId, { ...env, asset_index: working });
      await pushModules(userId);
      const stats = await reclaim(ids, userId, `delete_assets(module ${moduleId})`);
      return { ok: true, removed, ...stats };
    }
    const result = renameModuleAsset(env.asset_index, msg.oldName, msg.newName);
    if (!result.ok) {
      return { ok: false, ...(result.reason !== undefined ? { reason: result.reason } : {}) };
    }
    const nextEnv = { ...env, asset_index: result.index };
    await writeModuleEnvelope(userId, nextEnv);
    // asset_count summary changes, push fresh modules list.
    await pushModules(userId);
    return { ok: true };
  }

  async function mutateTriggerLua(
    msg: Extract<FrontendToBackend, { type: 'set_trigger_lua' }>,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (msg.source.kind === 'character') {
      const characterId = msg.source.characterId;
      let outcome: { ok: boolean; reason?: string } = { ok: true };
      const updated = await updateLumirealm(characterId, userId, (cur) => {
        const r = replaceTriggerLuaInArray(cur.payload.triggers, msg.triggerIndex, msg.lua);
        if (!r.ok || !r.triggers) {
          outcome = { ok: false, ...(r.reason ? { reason: r.reason } : {}) };
          return cur;
        }
        // Runtime reads lua_scripts by trigger index, re-derive only the affected entry and leave others verbatim.
        const newLua = extractLuaForTrigger(r.triggers[msg.triggerIndex]);
        const nextLuaScripts = [...cur.payload.lua_scripts];
        while (nextLuaScripts.length <= msg.triggerIndex) nextLuaScripts.push('');
        nextLuaScripts[msg.triggerIndex] = newLua;
        // requires.lua becomes the OR of any non-empty lua_script, recomputed defensively after mutation.
        const requiresLua = nextLuaScripts.some((s) => s.length > 0);
        return {
          ...cur,
          payload: {
            ...cur.payload,
            triggers: r.triggers,
            lua_scripts: nextLuaScripts,
            requires: { ...cur.payload.requires, lua: requiresLua },
          },
        };
      });
      if (!updated) {
        return outcome.ok
          ? { ok: false, reason: 'character is not a lumirealm card' }
          : outcome;
      }
      return outcome;
    }

    const moduleId = msg.source.moduleId;
    const env = await readModuleEnvelope(userId, moduleId);
    if (!env) return { ok: false, reason: `module ${moduleId} not in library` };
    const moduleBody = env.module as { trigger?: readonly unknown[] };
    const r = replaceTriggerLuaInArray(
      moduleBody.trigger ?? [],
      msg.triggerIndex,
      msg.lua,
    );
    if (!r.ok || !r.triggers) {
      return { ok: false, ...(r.reason ? { reason: r.reason } : {}) };
    }
    const nextEnv = {
      ...env,
      module: {
        ...(env.module as Record<string, unknown>),
        trigger: r.triggers,
      } as typeof env.module,
    };
    await writeModuleEnvelope(userId, nextEnv);
    await pushModules(userId);
    return { ok: true };
  }

  return { refreshRisuAssetMap, mutateAssetIndex, mutateTriggerLua };
}
