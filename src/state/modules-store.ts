// Module envelope storage under `lumirealm/modules/<moduleId>.json` in spindle.userStorage.
// index.json caches a summary list so listModules avoids opening every envelope.

import type { RisuModule } from '../core/schemas/module.js';

const MODULES_DIR = 'lumirealm/modules';
const INDEX_PATH = `${MODULES_DIR}/index.json`;

/** Bump on breaking changes; loader does additive forward-compat. */
export const MODULE_SCHEMA_VERSION = 1 as const;

export function resolveAttachedHandlesByIdOrNamespace<
  T extends { readonly id: string; readonly module?: { readonly namespace?: unknown } | undefined },
>(handles: readonly string[], library: readonly T[]): readonly T[] {
  if (handles.length === 0) return [];
  const handleSet = new Set(handles);
  const out: T[] = [];
  const seenIds = new Set<string>();

  // Pass 1: direct id matches in attach order.
  for (const h of handles) {
    const env = library.find((e) => e.id === h);
    if (env && !seenIds.has(env.id)) {
      out.push(env);
      seenIds.add(env.id);
    }
  }

  // Pass 2: namespace fallback for handles that didn't resolve by id.
  for (const env of library) {
    if (seenIds.has(env.id)) continue;
    const ns = env.module?.namespace;
    if (typeof ns === 'string' && ns.length > 0 && handleSet.has(ns)) {
      out.push(env);
      seenIds.add(env.id);
    }
  }

  return out;
}

export interface ModuleEnvelope {
  readonly schema_version: typeof MODULE_SCHEMA_VERSION;
  readonly id: string;
  readonly filename: string;
  readonly uploaded_at: number;
  readonly module: RisuModule;
  readonly asset_index: Readonly<Record<string, AssetRef>>;
  readonly installed_world_book_id?: string;
  // Lazy retranslation on attach fires when stored < current.
  readonly translator_schema_version?: number;
  readonly translations?: ModuleTranslations;
}

// Outer key = target language code, display-only browser-translated cache.
export interface ModuleTranslations {
  readonly [lang: string]: ModuleLangTranslation | undefined;
}

export interface ModuleLangTranslation {
  readonly name?: string;
  readonly description?: string;
  // Lorebook entry translations keyed by extensions._risu_source_hash.
  readonly lorebook?: Readonly<Record<string, EntryTranslation>>;
  // Toggle DSL labels + caption / divider / group / option text, keyed by original text.
  // Per-row identity is the text itself, so two rows with identical text share one translation.
  readonly toggles?: Readonly<Record<string, string>>;
}

export interface EntryTranslation {
  readonly comment?: string;
}

export interface AssetRef {
  readonly imageId: string;
  readonly ext?: string;
  /** Original byte length — useful for the editor UI's display ("3.2 MB"). */
  readonly bytes?: number;
}

/** Lightweight summary written to index.json on every envelope write. */
export interface ModuleIndexEntry {
  readonly id: string;
  readonly filename: string;
  readonly name: string;
  readonly description: string;
  readonly uploaded_at: number;
  readonly lorebook_count: number;
  readonly regex_count: number;
  readonly trigger_count: number;
  readonly asset_count: number;
  readonly low_level_access: boolean;
  readonly has_cjs: boolean;
  /** Per-language display-translation cache snapshot for name + description.
   *  Lorebook entry translations stay on the envelope (size). */
  readonly translatedName?: Readonly<Record<string, string>>;
  readonly translatedDescription?: Readonly<Record<string, string>>;
}

export interface ModuleIndex {
  readonly schema_version: typeof MODULE_SCHEMA_VERSION;
  readonly entries: readonly ModuleIndexEntry[];
  /** Applied to every character, on top of that character's attached ids. */
  readonly global_module_ids?: readonly string[];
}

// Globals first so a character's own attachments resolve later and win on
// conflict, matching how per-character config overrides defaults elsewhere.
export function resolveEffectiveModuleIds(
  globalIds: readonly string[] | undefined,
  attachedIds: readonly string[] | undefined,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(globalIds ?? []), ...(attachedIds ?? [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}


export interface UserStorageLike {
  read(path: string, userId?: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array, userId?: string): Promise<void>;
  delete(path: string, userId?: string): Promise<void>;
  list(prefix: string, userId?: string): Promise<readonly string[]>;
  exists(path: string, userId?: string): Promise<boolean>;
  getJson<T = unknown>(
    path: string,
    options?: { fallback?: T; userId?: string },
  ): Promise<T>;
  setJson(
    path: string,
    value: unknown,
    options?: { indent?: number; userId?: string },
  ): Promise<void>;
}


export function envelopePath(moduleId: string): string {
  return `${MODULES_DIR}/${moduleId}.json`;
}

/** Build a `ModuleIndexEntry` from an envelope. Pure. */
export function summarizeEnvelope(env: ModuleEnvelope): ModuleIndexEntry {
  const m = env.module;
  const translatedName: Record<string, string> = {};
  const translatedDescription: Record<string, string> = {};
  if (env.translations) {
    for (const lang of Object.keys(env.translations)) {
      const t = env.translations[lang];
      if (!t) continue;
      if (typeof t.name === 'string' && t.name.length > 0) translatedName[lang] = t.name;
      if (typeof t.description === 'string' && t.description.length > 0) {
        translatedDescription[lang] = t.description;
      }
    }
  }
  return {
    id: env.id,
    filename: env.filename,
    name: typeof m.name === 'string' ? m.name : '(unnamed)',
    description: typeof m.description === 'string' ? m.description : '',
    uploaded_at: env.uploaded_at,
    lorebook_count: Array.isArray(m.lorebook) ? m.lorebook.length : 0,
    regex_count: Array.isArray(m.regex) ? m.regex.length : 0,
    trigger_count: Array.isArray(m.trigger) ? m.trigger.length : 0,
    asset_count: Object.keys(env.asset_index).length,
    low_level_access: m.lowLevelAccess === true,
    has_cjs: typeof m.cjs === 'string' && m.cjs.length > 0,
    ...(Object.keys(translatedName).length > 0 ? { translatedName } : {}),
    ...(Object.keys(translatedDescription).length > 0 ? { translatedDescription } : {}),
  };
}

/** Insert / replace `entry` in `index.entries` keyed by `id`. Pure. */
export function upsertIndex(index: ModuleIndex, entry: ModuleIndexEntry): ModuleIndex {
  const filtered = index.entries.filter((e) => e.id !== entry.id);
  return {
    schema_version: MODULE_SCHEMA_VERSION,
    entries: [...filtered, entry].sort((a, b) => b.uploaded_at - a.uploaded_at),
  };
}

/** Remove the entry with `id` from the index. Pure. Idempotent. */
export function removeFromIndex(index: ModuleIndex, id: string): ModuleIndex {
  const next = index.entries.filter((e) => e.id !== id);
  if (next.length === index.entries.length) return index;
  return { schema_version: MODULE_SCHEMA_VERSION, entries: next };
}

const EMPTY_INDEX: ModuleIndex = {
  schema_version: MODULE_SCHEMA_VERSION,
  entries: [],
};


export async function readIndex(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<ModuleIndex> {
  try {
    const raw = await storage.getJson<ModuleIndex>(INDEX_PATH, {
      fallback: EMPTY_INDEX,
      ...(userId === undefined ? {} : { userId }),
    });
    if (!raw || typeof raw !== 'object') return EMPTY_INDEX;
    if ((raw as { schema_version?: unknown }).schema_version !== MODULE_SCHEMA_VERSION) {
      return EMPTY_INDEX;
    }
    if (!Array.isArray((raw as { entries?: unknown }).entries)) return EMPTY_INDEX;
    return raw;
  } catch {
    return EMPTY_INDEX;
  }
}

export async function writeIndex(
  storage: UserStorageLike,
  userId: string | undefined,
  index: ModuleIndex,
): Promise<void> {
  await storage.setJson(INDEX_PATH, index, {
    indent: 2,
    ...(userId === undefined ? {} : { userId }),
  });
}

export async function readEnvelope(
  storage: UserStorageLike,
  userId: string | undefined,
  moduleId: string,
): Promise<ModuleEnvelope | null> {
  try {
    const env = await storage.getJson<ModuleEnvelope>(envelopePath(moduleId), {
      ...(userId === undefined ? {} : { userId }),
    });
    if (!env || typeof env !== 'object') return null;
    if ((env as { schema_version?: unknown }).schema_version !== MODULE_SCHEMA_VERSION) {
      return null;
    }
    return env;
  } catch {
    return null;
  }
}

export async function writeEnvelope(
  storage: UserStorageLike,
  userId: string | undefined,
  envelope: ModuleEnvelope,
): Promise<ModuleIndexEntry> {
  await storage.setJson(envelopePath(envelope.id), envelope, {
    indent: 2,
    ...(userId === undefined ? {} : { userId }),
  });
  const index = await readIndex(storage, userId);
  const entry = summarizeEnvelope(envelope);
  await writeIndex(storage, userId, upsertIndex(index, entry));
  return entry;
}

/** Delete the envelope file and remove its index entry. Idempotent. */
export async function deleteModule(
  storage: UserStorageLike,
  userId: string | undefined,
  moduleId: string,
): Promise<void> {
  try {
    await storage.delete(envelopePath(moduleId), userId);
  } catch {
    // may not exist
  }
  const index = await readIndex(storage, userId);
  const next = removeFromIndex(index, moduleId);
  const globals = next.global_module_ids ?? [];
  // A deleted module must not linger as a global, or it silently fails to
  // resolve on every character forever.
  const prunedGlobals = globals.filter((id) => id !== moduleId);
  const withGlobals = prunedGlobals.length === globals.length
    ? next
    : { ...next, global_module_ids: prunedGlobals };
  if (withGlobals !== index) {
    await writeIndex(storage, userId, withGlobals);
  }
}

export async function readGlobalModuleIds(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<readonly string[]> {
  const index = await readIndex(storage, userId);
  const ids = index.global_module_ids;
  if (!Array.isArray(ids)) return [];
  const known = new Set(index.entries.map((e) => e.id));
  return ids.filter((id) => typeof id === 'string' && known.has(id));
}

export async function writeGlobalModuleIds(
  storage: UserStorageLike,
  userId: string | undefined,
  ids: readonly string[],
): Promise<readonly string[]> {
  const index = await readIndex(storage, userId);
  const known = new Set(index.entries.map((e) => e.id));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  await writeIndex(storage, userId, { ...index, global_module_ids: next });
  return next;
}

/** Read the cached index. For a full rebuild use `rebuildIndex`. */
export async function listModules(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<readonly ModuleIndexEntry[]> {
  const index = await readIndex(storage, userId);
  return index.entries;
}

export function pairModuleAssetsForUpload(
  manifest: readonly (readonly [string, string, string])[],
  bytesList: readonly Uint8Array[],
  bytesToBase64: (b: Uint8Array) => string,
  mimeFor: (name: string) => string,
): readonly { path: string; base64: string; mimeType: string; sourceIndex: number }[] {
  const out: { path: string; base64: string; mimeType: string; sourceIndex: number }[] = [];
  const pairCount = Math.min(manifest.length, bytesList.length);
  for (let i = 0; i < pairCount; i++) {
    const triple = manifest[i];
    const bytes = bytesList[i];
    if (!Array.isArray(triple) || bytes === undefined) continue;
    const name = typeof triple[0] === 'string' ? triple[0] : '';
    if (name.length === 0) continue;
    out.push({
      path: name,
      base64: bytesToBase64(bytes),
      mimeType: mimeFor(name),
      sourceIndex: i,
    });
  }
  return out;
}

export async function rebuildIndex(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<ModuleIndex> {
  let names: readonly string[];
  try {
    names = await storage.list(MODULES_DIR, userId);
  } catch {
    names = [];
  }
  const entries: ModuleIndexEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    const id = name.replace(/\.json$/i, '');
    const env = await readEnvelope(storage, userId, id);
    if (env) entries.push(summarizeEnvelope(env));
  }
  const index: ModuleIndex = {
    schema_version: MODULE_SCHEMA_VERSION,
    entries: [...entries].sort((a, b) => b.uploaded_at - a.uploaded_at),
  };
  await writeIndex(storage, userId, index);
  return index;
}
