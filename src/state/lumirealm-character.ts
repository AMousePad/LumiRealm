// Wraps `spindle.characters.{get,update,list}` for the `lumirealm` extension key.
// userId is required positionally on get/update/delete; options-bag on list.
// `extensions: { lumirealm: null }` writes a null sentinel, not a deletion.
// `isLumirealmData(null) === false` so consumers treat null as absent.

import { isLumirealmData } from '../payload/codec.js';
import {
  LUMIREALM_EXT_KEY,
  type AssetIndexEntry,
  type LumirealmCharacterData,
  type LumirealmUserOverrides,
  type RisuPayload,
  type StoredRegexScript,
  type StoredRisuCard,
} from '../payload/types.js';
import { parseScriptstateDefaults } from '../core/pipeline/risu-payload.js';
import { expectCharacterEdit } from './own-character-edit.js';
import { makeSafeLogger } from '../util/safe-log.js';

const logger = makeSafeLogger('lumirealm:character');
const logInfo = (msg: string): void => logger.info(msg);
const logDebug = (msg: string): void => logger.debug(msg);
const logWarn = (msg: string): void => logger.warn(msg);
const logError = (msg: string): void => logger.error(msg);

// Structural subset so unit tests can inject a mock without the full SpindleAPI.

export interface CharacterDTOLike {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly personality?: string;
  readonly scenario?: string;
  readonly first_mes?: string;
  readonly mes_example?: string;
  readonly creator?: string;
  readonly creator_notes?: string;
  readonly system_prompt?: string;
  readonly post_history_instructions?: string;
  readonly tags?: readonly string[];
  readonly alternate_greetings?: readonly string[];
  readonly image_id?: string | null;
  readonly world_book_ids?: readonly string[];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly created_at?: number;
  readonly updated_at?: number;
}

export interface CharacterUpdateInput {
  readonly extensions?: Readonly<Record<string, unknown>>;

}

export interface SpindleCharactersApi {
  get(characterId: string, userId?: string): Promise<CharacterDTOLike | null>;
  update(
    characterId: string,
    input: CharacterUpdateInput,
    userId?: string,
  ): Promise<CharacterDTOLike>;
  list(
    options?: { limit?: number; offset?: number; userId?: string },
  ): Promise<{ data: readonly CharacterDTOLike[]; total: number }>;
}


export interface LumirealmFetchResult {
  readonly character: CharacterDTOLike;
  readonly data: LumirealmCharacterData | null;
  readonly risuai: Readonly<Record<string, unknown>>;
}

export async function readLumirealm(
  api: SpindleCharactersApi,
  characterId: string,
  userId: string | undefined,
): Promise<LumirealmFetchResult | null> {
  const t0 = Date.now();
  let character: CharacterDTOLike | null;
  try {
    character = await api.get(characterId, userId);
  } catch (err) {
    logError(`readLumirealm: get(${characterId}) threw — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!character) {
    logInfo(`readLumirealm: character not found id=${characterId}`);
    return null;
  }
  const ext = (character.extensions ?? {}) as Record<string, unknown>;
  const rawLumi = ext[LUMIREALM_EXT_KEY];
  const data = isLumirealmData(rawLumi) ? rawLumi : null;
  const risuai = (ext['risuai'] && typeof ext['risuai'] === 'object'
    ? (ext['risuai'] as Record<string, unknown>)
    : {}) as Readonly<Record<string, unknown>>;
  if (!data) {
    logInfo(
      `readLumirealm: not a lumirealm character id=${characterId} ` +
      `lumirealm_key=${rawLumi === null ? 'null' : typeof rawLumi} ` +
      `elapsed=${Date.now() - t0}ms`,
    );
    return { character, data: null, risuai };
  }
  // `isLumirealmData` is shallow (schema_version only). Log enough to diagnose
  // corruption before downstream consumers surface a toast.
  const tv = (data as { translator_version?: unknown }).translator_version;
  const triggerCount = (data.payload as { triggers?: { length?: unknown } } | undefined)
    ?.triggers?.length;
  const regexCount = (data.regex_scripts as { length?: unknown } | undefined)?.length;
  const assetIdx = data.asset_index;
  const assetCount = assetIdx && typeof assetIdx === 'object'
    ? Object.keys(assetIdx).length : '?';
  logInfo(
    `readLumirealm: hit id=${characterId} translator=${typeof tv === 'string' ? tv : '?'} ` +
    `triggers=${typeof triggerCount === 'number' ? triggerCount : '?'} ` +
    `regex=${typeof regexCount === 'number' ? regexCount : '?'} ` +
    `assets=${assetCount} elapsed=${Date.now() - t0}ms`,
  );
  return { character, data, risuai };
}


export async function writeLumirealm(
  api: SpindleCharactersApi,
  characterId: string,
  data: LumirealmCharacterData,
  userId: string | undefined,
): Promise<void> {
  const t0 = Date.now();
  // Mark the upcoming CHARACTER_EDITED echo as our own so the handler skips
  // a redundant invalidate. See own-character-edit.ts.
  expectCharacterEdit(characterId);
  try {
    await api.update(
      characterId,
      { extensions: { [LUMIREALM_EXT_KEY]: { ...data, display_owner: true } } },
      userId,
    );
    logInfo(
      `writeLumirealm: ok id=${characterId} schema=${data.schema_version} ` +
      `regex=${data.regex_scripts.length} assets=${Object.keys(data.asset_index).length} ` +
      `elapsed=${Date.now() - t0}ms`,
    );
  } catch (err) {
    logError(`writeLumirealm: update(${characterId}) threw — ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export async function updateLumirealm(
  api: SpindleCharactersApi,
  characterId: string,
  userId: string | undefined,
  mutator: (current: LumirealmCharacterData) => LumirealmCharacterData,
): Promise<LumirealmCharacterData | null> {
  const fetched = await readLumirealm(api, characterId, userId);
  if (!fetched || !fetched.data) {
    logWarn(`updateLumirealm: skipping — not a lumirealm character id=${characterId}`);
    return null;
  }
  const next = mutator(fetched.data);
  await writeLumirealm(api, characterId, next, userId);
  return next;
}

export async function clearLumirealm(
  api: SpindleCharactersApi,
  characterId: string,
  userId: string | undefined,
): Promise<boolean> {
  expectCharacterEdit(characterId);
  try {
    await api.update(
      characterId,
      { extensions: { [LUMIREALM_EXT_KEY]: null } },
      userId,
    );
    logInfo(`clearLumirealm: soft-removed id=${characterId}`);
    return true;
  } catch (err) {
    logError(`clearLumirealm: update(${characterId}) threw — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}


export interface ListLumirealmEntry {
  readonly character: CharacterDTOLike;
  readonly data: LumirealmCharacterData;
}

export async function listLumirealmCharacters(
  api: SpindleCharactersApi,
  userId: string | undefined,
  opts?: { limit?: number; paginate?: boolean },
): Promise<readonly ListLumirealmEntry[]> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 200));
  const paginate = opts?.paginate ?? false;
  const out: ListLumirealmEntry[] = [];
  let offset = 0;
  let pages = 0;
  const t0 = Date.now();
  while (true) {
    pages += 1;
    let page: { data: readonly CharacterDTOLike[]; total: number };
    try {
      // userId is options-bag on list, positional on get/update/delete.
      page = await api.list({ limit, offset, ...(userId === undefined ? {} : { userId }) });
    } catch (err) {
      logError(`listLumirealmCharacters: list({ limit:${limit}, offset:${offset} }) threw — ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    for (const character of page.data) {
      const ext = (character.extensions ?? {}) as Record<string, unknown>;
      const raw = ext[LUMIREALM_EXT_KEY];
      if (!isLumirealmData(raw)) continue;
      out.push({ character, data: raw });
    }
    if (!paginate) break;
    if (page.data.length < limit) break;
    offset += limit;
    if (pages >= 50) { // 50 × 200 = 10000 — defensive cap
      logWarn(`listLumirealmCharacters: paginate cap hit at offset=${offset} — bailing`);
      break;
    }
  }
  logDebug(
    `listLumirealmCharacters: hits=${out.length} pages=${pages} ` +
    `elapsed=${Date.now() - t0}ms`,
  );
  return out;
}

// `risu_spec_version` is empty string. The extension never reads it at
// runtime, only at load-time validation which has already passed.
const SYNTHETIC_RISU_SPEC_VERSION = '' as const;

interface RisuaiBlob {
  readonly backgroundHTML?: unknown;
  readonly utilityBot?: unknown;
  readonly defaultVariables?: unknown;
  readonly emotions?: unknown;
  readonly [k: string]: unknown;
}

export interface AttachedModuleForRuntime {
  readonly id: string;
  /**
   * Persisted character handles that resolved to this module. A replacement
   * module can be selected through its namespace instead of its current ID.
   */
  readonly attachment_handles?: readonly string[] | undefined;
  readonly triggers: readonly unknown[];
  /** Parallel to `triggers`. Empty string when no `triggerlua` effect. */
  readonly lua_scripts: readonly string[];
  /** Raw source retained only on the in-memory runtime card. */
  readonly lorebook: readonly unknown[];
  readonly asset_index: Readonly<Record<string, AssetIndexEntry>>;
  /** Folds into `requires.lowLevelAccess` so module-supplied LLM/network calls trigger consent. */
  readonly low_level_access: boolean;
  readonly custom_module_toggle?: string | undefined;
  readonly display_name?: string | undefined;
  readonly background_embedding?: string | undefined;
  readonly namespace?: string | undefined;
}

export function mergeAttachedModulesIntoPayload(
  basePayload: RisuPayload,
  baseAssetIndex: Readonly<Record<string, AssetIndexEntry>>,
  modules: readonly AttachedModuleForRuntime[],
): {
  triggers: readonly unknown[];
  lua_scripts: readonly string[];
  asset_index: Readonly<Record<string, AssetIndexEntry>>;
  requires: RisuPayload['requires'];
  module_background_embedding: string;
  modules_by_namespace: Readonly<Record<string, readonly string[]>>;
} {
  if (modules.length === 0) {
    return {
      triggers: basePayload.triggers,
      lua_scripts: basePayload.lua_scripts,
      asset_index: baseAssetIndex,
      requires: basePayload.requires,
      module_background_embedding: '',
      modules_by_namespace: {},
    };
  }
  const triggers = [...basePayload.triggers];
  const lua_scripts = [...basePayload.lua_scripts];
  const moduleAssets: Record<string, AssetIndexEntry> = {};
  const modulesByNamespace: Record<string, string[]> = {};
  let bgEmbed = '';
  for (const m of modules) {
    for (const [name, entry] of Object.entries(m.asset_index)) {
      moduleAssets[name] = entry;
    }
    const nsKey = (typeof m.namespace === 'string' && m.namespace.length > 0) ? m.namespace : m.id;
    const assetNames = Object.keys(m.asset_index);
    if (modulesByNamespace[nsKey]) {
      modulesByNamespace[nsKey].push(...assetNames);
    } else {
      modulesByNamespace[nsKey] = [...assetNames];
    }
    if (nsKey !== m.id && !modulesByNamespace[m.id]) {
      modulesByNamespace[m.id] = [...assetNames];
    }
    for (let i = 0; i < m.triggers.length; i++) {
      const trig = m.triggers[i];
      if (m.low_level_access && trig && typeof trig === 'object') {
        triggers.push({ ...(trig as Record<string, unknown>), lowLevelAccess: true });
      } else {
        triggers.push(trig);
      }
      lua_scripts.push(m.lua_scripts[i] ?? '');
    }
    if (typeof m.background_embedding === 'string' && m.background_embedding.length > 0) {
      bgEmbed += '\n' + m.background_embedding + '\n';
    }
  }
  const finalAssetIndex: Record<string, AssetIndexEntry> = {
    ...moduleAssets,
    ...baseAssetIndex,
  };
  const folded: RisuPayload['requires'] = {
    lua:
      basePayload.requires.lua
      || modules.some((m) => m.triggers.length > 0 && m.lua_scripts.some((s) => s.length > 0)),
    lowLevelAccess:
      basePayload.requires.lowLevelAccess || modules.some((m) => m.low_level_access),
    hostFeatures: basePayload.requires.hostFeatures,
  };
  return {
    triggers,
    lua_scripts,
    asset_index: finalAssetIndex,
    requires: folded,
    module_background_embedding: bgEmbed,
    modules_by_namespace: modulesByNamespace,
  };
}

export function buildSyntheticStoredCard(
  characterId: string,
  data: LumirealmCharacterData,
  risuai: RisuaiBlob,
  attachedModules: readonly AttachedModuleForRuntime[] = [],
): StoredRisuCard {
  // Risu-parity master string wins outright when present.
  // Otherwise prefer lumirealm.payload baseline + legacy per-key overrides.
  const lumiDefaults = data.payload.scriptstate_defaults;
  const cardDefaults = lumiDefaults && Object.keys(lumiDefaults).length > 0
    ? lumiDefaults
    : parseScriptstateDefaults(
        typeof risuai.defaultVariables === 'string' ? risuai.defaultVariables : null,
      );
  const masterText = data.user_overrides.default_variables_text;
  const mergedDefaults: Record<string, string> = typeof masterText === 'string'
    ? parseScriptstateDefaults(masterText)
    : { ...cardDefaults, ...(data.user_overrides.default_variables_overrides ?? {}) };

  const lumiUtilityBot = data.payload.utility_bot;
  const cardUtilityBot = typeof lumiUtilityBot === 'boolean'
    ? lumiUtilityBot
    : (typeof risuai.utilityBot === 'boolean' ? risuai.utilityBot : false);
  const utilityBot = data.user_overrides.utility_bot_override ?? cardUtilityBot;

  const lumiBg = data.payload.background_html;
  const backgroundHtml =
    typeof lumiBg === 'string' && lumiBg.length > 0
      ? lumiBg
      : typeof risuai.backgroundHTML === 'string' && risuai.backgroundHTML.length > 0
        ? risuai.backgroundHTML
        : null;

  // Pre-merge: fold attached-module triggers/lua/assets/requires into
  const baseRequires = data.payload.requires;
  const baseTrigCount = data.payload.triggers.length;
  const baseLuaCount = data.payload.lua_scripts.length;
  const merged = mergeAttachedModulesIntoPayload(
    {
      triggers: data.payload.triggers,
      lua_scripts: data.payload.lua_scripts,
      at_actions: data.payload.at_actions,
      background_html: backgroundHtml,
      virtualscript: null,
      utility_bot: utilityBot,
      scriptstate_defaults: mergedDefaults,
      additional_assets: [],
      emotion_images: [],
      extra: {},
      translator_version: data.translator_version,
      risu_spec_version: SYNTHETIC_RISU_SPEC_VERSION,
      requires: baseRequires,
    },
    data.asset_index,
    attachedModules,
  );

  const risuPayload: RisuPayload = {
    triggers: merged.triggers,
    lua_scripts: merged.lua_scripts,
    at_actions: data.payload.at_actions,
    background_html: backgroundHtml,
    ...(merged.module_background_embedding.length > 0
      ? { module_background_embedding: merged.module_background_embedding }
      : {}),
    virtualscript: null,
    utility_bot: utilityBot,
    scriptstate_defaults: mergedDefaults,
    additional_assets: [],
    emotion_images: [],
    extra: {
      ...(attachedModules.length > 0
        ? {
            attached_modules: attachedModules.map((m) => m.id),
            runtime_module_library_order: attachedModules.map((m) => m.id),
            base_trigger_count: baseTrigCount,
            base_lua_count: baseLuaCount,
            modules_by_namespace: merged.modules_by_namespace,
            runtime_module_lorebooks: Object.fromEntries(
              attachedModules.map((m) => [m.id, m.lorebook]),
            ),
            runtime_module_identities: Object.fromEntries(
              attachedModules.map((m) => {
                const persistedHandles = [
                  ...new Set(
                    (m.attachment_handles ?? [m.id])
                      .filter((value) => value.length > 0),
                  ),
                ];
                const aliases =
                  typeof m.namespace === 'string' && m.namespace.length > 0
                    ? [m.namespace]
                    : [];
                return [
                  m.id,
                  {
                    persisted_handles: persistedHandles,
                    aliases,
                  },
                ];
              }),
            ),
          }
        : {}),
    },
    translator_version: data.translator_version,
    risu_spec_version: SYNTHETIC_RISU_SPEC_VERSION,
    requires: merged.requires,
    ...(data.payload.untranslated ? { untranslated: data.payload.untranslated } : {}),
  };

  return {
    schema_version: 1,
    character_id: characterId,
    stored_at: data.imported_at,
    extension_version: data.extension_version,
    risuPayload,
    asset_index: merged.asset_index as Record<string, AssetIndexEntry>,
    emotion_index: data.emotion_index as Record<string, AssetIndexEntry>,
    ...(data.regex_scripts.length > 0
      ? { regex_scripts: data.regex_scripts as readonly StoredRegexScript[] }
      : {}),
  };
}

export function mergeUserOverrides(
  base: LumirealmUserOverrides,
  patch: Readonly<{
    [K in keyof LumirealmUserOverrides]?:
      | LumirealmUserOverrides[K]
      | null
      | undefined;
  }>,
): LumirealmUserOverrides {
  const out: { -readonly [K in keyof LumirealmUserOverrides]?: LumirealmUserOverrides[K] } = {
    ...base,
  };
  for (const k of Object.keys(patch) as (keyof LumirealmUserOverrides)[]) {
    const v = patch[k];
    if (v === null) {
      delete out[k];
      continue;
    }
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export type ModuleTrackingPatch = {
  attached_module_ids?: readonly string[];
  attached_module_world_books?: Readonly<Record<string, string>> | null;
  attached_module_regex_script_ids?: Readonly<Record<string, readonly string[]>> | null;
};

// Empty maps collapse to null so mergeUserOverrides drops the key entirely.
// Without this, detaching the last module leaves orphaned `attached_module_world_books: {}`
// in the envelope.
export function buildAttachModulePatch(
  current: LumirealmUserOverrides,
  moduleId: string,
  worldBookId: string | null,
): ModuleTrackingPatch {
  const ids = current.attached_module_ids ?? [];
  const wb: Record<string, string> = { ...(current.attached_module_world_books ?? {}) };
  if (worldBookId) wb[moduleId] = worldBookId;
  return {
    attached_module_ids: [...ids, moduleId],
    attached_module_world_books: Object.keys(wb).length > 0 ? wb : null,
  };
}

export function buildDetachModulesPatch(
  current: LumirealmUserOverrides,
  moduleIds: readonly string[],
): ModuleTrackingPatch {
  const idsSet = new Set(moduleIds);
  const nextIds = (current.attached_module_ids ?? []).filter((id) => !idsSet.has(id));
  const wb: Record<string, string> = { ...(current.attached_module_world_books ?? {}) };
  const rx: Record<string, readonly string[]> = { ...(current.attached_module_regex_script_ids ?? {}) };
  for (const id of moduleIds) {
    delete wb[id];
    delete rx[id];
  }
  return {
    attached_module_ids: nextIds,
    attached_module_world_books: Object.keys(wb).length > 0 ? wb : null,
    attached_module_regex_script_ids: Object.keys(rx).length > 0 ? rx : null,
  };
}
