import type {
  AttachedModuleSummary,
  ModuleSummary,
  CardSummary,
  BackendToFrontend,
  FrontendToBackend,
} from '../types/messages.js';
import type {
  AssetIndexEntry,
  LumirealmCharacterData,
} from '../payload/types.js';
import type { ModuleEnvelope, ModuleIndexEntry } from './modules-store.js';
import type { AttachedModuleForRuntime } from './lumirealm-character.js';
import { coerceAtActionsFromScripts } from '../interpreter/at-actions-runtime.js';
import { mergeLangBlock } from './translation-merge.js';
import { expectCharacterEdit } from './own-character-edit.js';
import { setGlobalModuleIdsCache } from './global-modules-cache.js';

export interface ModulePushesDeps {
  readonly translateLang: string;
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<{ data: LumirealmCharacterData | null } | null>;
  readonly writeLumirealm: (
    characterId: string,
    data: LumirealmCharacterData,
    userId: string,
  ) => Promise<unknown>;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly writeModuleEnvelope: (userId: string, env: ModuleEnvelope) => Promise<void>;
  readonly listModuleStore: (userId: string) => Promise<readonly ModuleIndexEntry[]>;
  readonly readGlobalModuleIds: (userId: string) => Promise<readonly string[]>;
  readonly listLumirealmCharacters: (userId: string) => Promise<readonly {
    readonly character: { readonly id: string };
    readonly data: LumirealmCharacterData;
  }[]>;
  readonly listCards: (userId: string | undefined) => Promise<readonly CardSummary[]>;
  readonly pushCards: (cards: readonly CardSummary[], userId: string | undefined) => void;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface ModulePushes {
  readonly pushModules: (userId: string) => Promise<void>;
  readonly pushAttachedForCharacter: (characterId: string, userId: string) => Promise<void>;
  readonly persistModuleTranslation: (
    userId: string,
    msg: Extract<FrontendToBackend, { type: 'cache_module_translation' }>,
  ) => Promise<void>;
  readonly persistCharacterTranslation: (
    userId: string,
    msg: Extract<FrontendToBackend, { type: 'cache_character_translation' }>,
  ) => Promise<void>;
  readonly readAttachedModuleEnvelopes: (
    userId: string,
    attachedIds: readonly string[],
  ) => Promise<readonly ModuleEnvelope[]>;
  readonly loadAttachedModulesForRuntime: (
    userId: string,
    attachedIds: readonly string[],
  ) => Promise<readonly AttachedModuleForRuntime[]>;
}

export function createModulePushes(deps: ModulePushesDeps): ModulePushes {
  const {
    translateLang,
    readLumirealm,
    writeLumirealm,
    readModuleEnvelope,
    writeModuleEnvelope,
    listModuleStore,
    readGlobalModuleIds: readGlobals,
    listLumirealmCharacters,
    listCards,
    pushCards,
    send,
    log,
    errMsg,
  } = deps;

  async function buildAttachedByCharacter(
    userId: string,
    libraryById: ReadonlyMap<string, ModuleSummary>,
  ): Promise<Record<string, readonly AttachedModuleSummary[]>> {
    const out: Record<string, AttachedModuleSummary[]> = {};
    const entries = await listLumirealmCharacters(userId);
    for (const e of entries) {
      const ids = e.data.user_overrides.attached_module_ids ?? [];
      if (ids.length === 0) {
        out[e.character.id] = [];
        continue;
      }
      const list: AttachedModuleSummary[] = [];
      for (const id of ids) {
        const sum = libraryById.get(id);
        if (sum) {
          list.push({
            id: sum.id,
            name: sum.name,
            ...(sum.translatedName !== undefined ? { translatedName: sum.translatedName } : {}),
          });
        } else {
          // Surface modules deleted from the library while still referenced so the user can clean up.
          list.push({ id, name: '(missing, module deleted from library)' });
        }
      }
      out[e.character.id] = list;
    }
    return out;
  }

  async function pushModules(userId: string): Promise<void> {
    const indexEntries = await listModuleStore(userId);
    const wire: ModuleSummary[] = indexEntries.map((e) => {
      const translatedName = e.translatedName?.[translateLang];
      const translatedDescription = e.translatedDescription?.[translateLang];
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        ...(translatedName !== undefined ? { translatedName } : {}),
        ...(translatedDescription !== undefined ? { translatedDescription } : {}),
        filename: e.filename,
        uploaded_at: e.uploaded_at,
        lorebook_count: e.lorebook_count,
        regex_count: e.regex_count,
        trigger_count: e.trigger_count,
        asset_count: e.asset_count,
        low_level_access: e.low_level_access,
        has_cjs: e.has_cjs,
      };
    });
    const byId = new Map(wire.map((w) => [w.id, w]));
    const attached = await buildAttachedByCharacter(userId, byId);
    const globalIds = await readGlobals(userId);
    // Cache stays in step with every push, so the runtime resolution paths never
    // read a stale global list after an upload / delete / chip edit.
    setGlobalModuleIdsCache(userId, globalIds);
    send({
      type: 'modules_pushed',
      modules: wire,
      attached_by_character: attached,
      global_module_ids: globalIds,
    }, userId);
  }

  async function pushAttachedForCharacter(
    characterId: string,
    userId: string,
  ): Promise<void> {
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched || !fetched.data) {
      send({
        type: 'attached_modules_pushed',
        characterId,
        attached: [],
      }, userId);
      return;
    }
    const ids = fetched.data.user_overrides.attached_module_ids ?? [];
    const indexEntries = await listModuleStore(userId);
    const byId = new Map(indexEntries.map((e) => [e.id, e]));
    const list: AttachedModuleSummary[] = ids.map((id) => {
      const e = byId.get(id);
      if (!e) return { id, name: '(missing, module deleted from library)' };
      const tx = e.translatedName?.[translateLang];
      return { id, name: e.name, ...(tx !== undefined ? { translatedName: tx } : {}) };
    });
    send({ type: 'attached_modules_pushed', characterId, attached: list }, userId);
  }

  async function persistModuleTranslation(
    userId: string,
    msg: Extract<FrontendToBackend, { type: 'cache_module_translation' }>,
  ): Promise<void> {
    const env = await readModuleEnvelope(userId, msg.moduleId);
    if (!env) {
      log.warn(`cache_module_translation: module=${msg.moduleId} not found`);
      return;
    }
    const lang = msg.lang || translateLang;
    const nextLang = mergeLangBlock({
      existing: env.translations?.[lang] ?? {},
      ...(msg.name !== undefined ? { name: msg.name } : {}),
      ...(msg.description !== undefined ? { description: msg.description } : {}),
      ...(msg.lorebook !== undefined ? { lorebookItems: msg.lorebook } : {}),
      ...(msg.toggles !== undefined ? { toggleItems: msg.toggles } : {}),
    });
    const next: typeof env = {
      ...env,
      translations: { ...(env.translations ?? {}), [lang]: nextLang },
    };
    await writeModuleEnvelope(userId, next);
    await pushModules(userId);
  }

  async function persistCharacterTranslation(
    userId: string,
    msg: Extract<FrontendToBackend, { type: 'cache_character_translation' }>,
  ): Promise<void> {
    const fetched = await readLumirealm(msg.characterId, userId);
    if (!fetched || !fetched.data) {
      log.warn(`cache_character_translation: character=${msg.characterId} not lumirealm`);
      return;
    }
    const lang = msg.lang || translateLang;
    const existing = fetched.data.translations?.[lang] ?? {};
    const nameChanged = msg.name !== undefined && msg.name !== existing.name;
    const nextLang = mergeLangBlock({
      existing,
      ...(msg.name !== undefined ? { name: msg.name } : {}),
      ...(msg.lorebook !== undefined ? { lorebookItems: msg.lorebook } : {}),
    });
    const nextData = {
      ...fetched.data,
      translations: {
        ...(fetched.data.translations ?? {}),
        [lang]: nextLang,
      },
    };
    expectCharacterEdit(msg.characterId);
    await writeLumirealm(msg.characterId, nextData, userId);
    if (nameChanged) {
      pushCards(await listCards(userId), userId);
    }
  }

  async function readAttachedModuleEnvelopes(
    userId: string,
    attachedIds: readonly string[],
    librarySnapshot?:
      | readonly ModuleIndexEntry[]
      | Promise<readonly ModuleIndexEntry[]>,
  ): Promise<readonly ModuleEnvelope[]> {
    if (attachedIds.length === 0) return [];

    const directHits: ModuleEnvelope[] = [];
    const seenIds = new Set<string>();
    const missingHandles: string[] = [];
    for (const id of attachedIds) {
      const env = await readModuleEnvelope(userId, id);
      if (env && !seenIds.has(env.id)) {
        directHits.push(env);
        seenIds.add(env.id);
      } else if (!env) {
        missingHandles.push(id);
      }
    }

    if (missingHandles.length === 0) return directHits;

    // Risu namespace fallback. A re-uploaded module with namespace="<old-id>" resolves transparently without re-attach.
    let library: readonly ModuleIndexEntry[] = [];
    if (librarySnapshot !== undefined) {
      library = await librarySnapshot;
    } else {
      try {
        library = await listModuleStore(userId);
      } catch (err) {
        log.warn(
          `readAttachedModuleEnvelopes: namespace fallback list failed: ${errMsg(err)}`,
        );
        return directHits;
      }
    }

    const missingSet = new Set(missingHandles);
    const fallback: ModuleEnvelope[] = [];
    for (const summary of library) {
      if (seenIds.has(summary.id)) continue;
      const env = await readModuleEnvelope(userId, summary.id);
      if (!env) continue;
      const ns = (env.module as { namespace?: unknown }).namespace;
      if (typeof ns === 'string' && ns.length > 0 && missingSet.has(ns)) {
        fallback.push(env);
        seenIds.add(env.id);
        log.info(
          `readAttachedModuleEnvelopes: namespace match,handle="${ns}" → module id=${env.id} ` +
            `(transparent replacement / aliasing)`,
        );
      }
    }

    for (const h of missingHandles) {
      const matched = fallback.some((env) => {
        const ns = (env.module as { namespace?: unknown }).namespace;
        return typeof ns === 'string' && ns === h;
      });
      if (!matched) {
        log.warn(
          `readAttachedModuleEnvelopes: handle "${h}" did not resolve via id or namespace,skipping`,
        );
      }
    }

    return [...directHits, ...fallback];
  }

  async function loadAttachedModulesForRuntime(
    userId: string,
    attachedIds: readonly string[],
  ): Promise<readonly AttachedModuleForRuntime[]> {
    if (attachedIds.length === 0) return [];

    // Risu filters its module library by the attached handle set. The
    // library's order wins over the order of handles on the character.
    const libraryPromise = listModuleStore(userId).catch((err) => {
      log.warn(
        `loadAttachedModulesForRuntime: library-order snapshot failed: ${errMsg(err)}`,
      );
      return [] as readonly ModuleIndexEntry[];
    });
    const [envelopes, library] = await Promise.all([
      readAttachedModuleEnvelopes(userId, attachedIds, libraryPromise),
      libraryPromise,
    ]);
    const libraryOrder = new Map(
      library.map((entry, index) => [entry.id, index]),
    );
    const resolvedOrder = new Map(
      envelopes.map((env, index) => [env.id, index]),
    );
    const orderedEnvelopes = [...envelopes].sort((a, b) => {
      const aLibrary = libraryOrder.get(a.id);
      const bLibrary = libraryOrder.get(b.id);
      if (aLibrary !== undefined && bLibrary !== undefined) {
        return aLibrary - bLibrary;
      }
      if (aLibrary !== undefined) return -1;
      if (bLibrary !== undefined) return 1;
      return (resolvedOrder.get(a.id) ?? 0) - (resolvedOrder.get(b.id) ?? 0);
    });

    return orderedEnvelopes.map((env) => {
      const m = env.module as {
        trigger?: readonly unknown[];
        regex?: readonly unknown[];
        lorebook?: readonly unknown[];
        lowLevelAccess?: unknown;
        customModuleToggle?: unknown;
        name?: unknown;
        backgroundEmbedding?: unknown;
        namespace?: unknown;
      };
      const namespace =
        typeof m.namespace === 'string' && m.namespace.length > 0
          ? m.namespace
          : null;
      const attachmentHandles = attachedIds.filter(
        (handle) => handle === env.id || handle === namespace,
      );
      const triggers = Array.isArray(m.trigger) ? (m.trigger as readonly unknown[]) : [];
      const atActions = coerceAtActionsFromScripts(
        Array.isArray(m.regex) ? m.regex : [],
        `module:${env.id}`,
      );
      const lua_scripts = triggers.map((t) => {
        const tEff = (t as { effect?: readonly unknown[] }).effect ?? [];
        const parts: string[] = [];
        for (const e of tEff) {
          const eo = e as { type?: string; code?: string };
          if (eo.type === 'triggerlua' && typeof eo.code === 'string') {
            parts.push(eo.code);
          }
        }
        return parts.join('\n');
      });
      const runtimeAssetIndex: Record<string, AssetIndexEntry> = {};
      for (const [name, ref] of Object.entries(env.asset_index)) {
        runtimeAssetIndex[name] = {
          imageIds: [ref.imageId],
          ...(ref.ext !== undefined ? { ext: ref.ext } : {}),
        };
      }
      return {
        id: env.id,
        attachment_handles: [...new Set(attachmentHandles)],
        triggers,
        lua_scripts,
        at_actions: atActions,
        lorebook: Array.isArray(m.lorebook) ? m.lorebook : [],
        asset_index: runtimeAssetIndex,
        low_level_access: m.lowLevelAccess === true,
        ...(typeof m.customModuleToggle === 'string' && m.customModuleToggle.length > 0
          ? { custom_module_toggle: m.customModuleToggle }
          : {}),
        ...(typeof m.name === 'string' && m.name.length > 0
          ? { display_name: m.name }
          : {}),
        ...(typeof m.backgroundEmbedding === 'string' && m.backgroundEmbedding.length > 0
          ? { background_embedding: m.backgroundEmbedding }
          : {}),
        ...(namespace !== null
          ? { namespace }
          : {}),
      };
    });
  }

  return {
    pushModules,
    pushAttachedForCharacter,
    persistModuleTranslation,
    persistCharacterTranslation,
    readAttachedModuleEnvelopes,
    loadAttachedModulesForRuntime,
  };
}
