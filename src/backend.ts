declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { FrontendToBackend, BackendToFrontend, CardSummary } from './types/messages.js';
import { errMsg } from './util/coerce.js';
import {
  setupRealmBackend,
  isRealmFrontendMessage,
  type RealmBackendHandle,
} from './realm/backend.js';
import type { RealmBackendToFrontend } from './realm/messages.js';
import type { StoredRisuCard } from './payload/types.js';
import { CURRENT_CHARACTER_SCHEMA_VERSION } from './state/translator-migrations.js';
import { CURRENT_MODULE_SCHEMA_VERSION } from './state/module-migrations.js';
import { type UserStorageLike } from './payload/installer.js';
import {
  preValidateRequires,
  RisuCompatVersionError,
} from './payload/codec.js';
import {
  readLumirealm,
  writeLumirealm,
  updateLumirealm,
  clearLumirealm,
  listLumirealmCharacters,
  buildSyntheticStoredCard,
  mergeUserOverrides,
  buildDetachModulesPatch,
  type SpindleCharactersApi,
} from './state/lumirealm-character.js';
import {
  appendImageIdsToJournal,
  clearImageJournal,
  listImageJournalCharacterIds,
  readImageJournalFile,
  type JournalStorage,
} from './state/image-journal.js';
import {
  appendModuleImageIdsToJournal,
  clearModuleImageJournal,
  listModuleImageJournalIds,
  readModuleImageJournalFile,
} from './state/module-image-journal.js';
import { buildLiveImageIdSet } from './state/orphan-detect.js';
import {
  GENERATION_ENDED_BINDINGS,
  type ActiveCard,
} from './interpreter/dispatch.js';
import { type CompiledTriggerEntry, prepareTriggers } from './interpreter/dispatcher.js';
import { parseDirectLorebook } from './payload/lorebook-direct-import.js';
import { parseDirectRegex } from './payload/regex-direct-import.js';
import { mapRegex } from './core/mappers/regex.js';
import { createRegexImporter } from './state/regex-import.js';
import { mapLoreBook } from './core/mappers/lorebook.js';
import { setActiveAssetIndexes, clearActiveAssetIndexes } from './interpreter/asset-cache.js';
import {
  setActiveCharacterImage,
  clearActiveCharacterImage,
  imageUrlFromId,
} from './interpreter/image-cache.js';
import {
  setActiveScriptstateDefaults,
  clearActiveScriptstateDefaults,
} from './interpreter/defaults-cache.js';
import {
  setActiveLorebook,
  clearActiveLorebook,
  hasActiveLorebookForCharacter,
  getActiveLorebookByCharacter,
} from './state/lorebook-cache.js';
import { fetchLorebookForCharacter } from './state/lorebook-fetch.js';
import {
  setActiveModulesByNamespace,
  clearActiveModulesByNamespace,
} from './interpreter/modules-by-namespace-cache.js';
import { clearVarOverlay } from './interpreter/evaluator/context.js';
import { invalidateListenEditPreload } from './interpreter/listenedit-preload.js';
import { setCachedMessages, invalidateCachedMessages } from './interpreter/messages-cache.js';
import { setGlobalModuleIdsCache } from './state/global-modules-cache.js';
import {
  readCharacterRecency,
  touchRecency,
  writeCharacterRecency,
} from './state/character-recency.js';
import { setScreenDims } from './interpreter/screen-dims-cache.js';
import { VariableStateStore } from './state/variables-state.js';
import { ToggleStateStore } from './state/toggle-state.js';
import {
  initPermissions,
  getMissingPermissions,
  subscribeToMissingChanges,
  PERMISSION_PURPOSE,
} from './state/permissions.js';
import { pushViewerData, type ViewerPushDeps } from './state/viewer-push.js';
import { createViewerAssembly } from './state/viewer-assembly.js';
import { createLorebookImporter } from './state/lorebook-import.js';
import { createModuleUploader } from './state/module-upload.js';
import { createOrphanOrchestrator } from './state/orphan-orchestrator.js';
import type { Handler, HandlerCallCtx, HandlerRegistry } from './handlers/types.js';
import { createDisplayWritebackHandlers } from './handlers/display-writeback.js';
import { createScreenHandlers } from './handlers/screen.js';
import { createConsentHandlers } from './handlers/consent.js';
import { createConnectionsHandlers } from './handlers/connections.js';
import { createLogHandlers } from './handlers/log.js';
import { createSettingsHandlers } from './handlers/settings.js';
import { createTranslationsHandlers } from './handlers/translations.js';
import { createVariablesHandlers } from './handlers/variables.js';
import { createTogglesHandlers } from './handlers/toggles.js';
import { createDispatchHandlers } from './handlers/dispatch.js';
import { createLorebookHandlers } from './handlers/lorebook.js';
import { createRegexHandlers } from './handlers/regex.js';
import { createImportTextHandlers } from './handlers/import-text.js';
import { createAssetsHandlers } from './handlers/assets.js';
import { createViewerHandlers } from './handlers/viewer.js';
import { createModuleHandlers } from './handlers/module.js';
import { createExportHandlers } from './handlers/export.js';
import {
  createImportHandlers,
  type PendingImportCompletion,
} from './handlers/import.js';
import { createOrphanHandlers } from './handlers/orphan.js';
import { createRepairHandlers } from './handlers/repair.js';
import { createLifecycleEventHandlers } from './events/lifecycle.js';
import { createLumiInterceptors } from './interceptors/lumi-hooks.js';
import {
  createPromptRegexRunnerClient,
  isPromptRegexRunnerAvailable,
} from './interceptors/prompt-regex-runner-client.js';
import { createReadonlyResolver } from './state/readonly-resolver.js';
import { createMessageVarPass } from './state/message-var-pass.js';
import { createBgHtmlRefresher } from './state/bg-html.js';
import { createTriggerDispatcher } from './state/trigger-dispatch.js';
import { createRepairOrchestrator } from './state/repair-orchestrator.js';
import { createMigrationsRunner } from './state/migrations.js';
import { createMassMigrationsRunner } from './boot/mass-migrations.js';
import { createActiveCardLoader } from './state/active-card.js';
import { createApplySvgRasterIndex } from './boot/svg-raster-apply.js';
import {
  makeNudgeGc,
  makeRefreshPersonaImage,
  makeSeedAuthorsNoteFromDepthPrompt,
  makeMaybeFinalizeImport,
} from './boot/misc.js';
import { createVariablesTogglesService } from './state/variables-toggles.js';
import { assembleDisplaySnapshot } from './state/display-snapshot-assembly.js';
import { createSettingsService } from './state/settings-service.js';
import { makeCaptureUserId } from './boot/capture-user.js';
import { createImportCardOrchestrator } from './boot/import-card.js';
import { createWorldBookOps } from './state/world-book-ops.js';
import { createAssetTriggerMutate } from './state/asset-trigger-mutate.js';
import { createCharacterModuleAttach } from './state/character-module-attach.js';
import { createModulePushes } from './state/module-pushes.js';
import { createOrphanDetectBuilders } from './state/orphan-detect-builders.js';
import {
  createConsentApi,
  makeQueueModalConfirm,
  makeDeleteCardByChar,
} from './state/consent-modals.js';
import {
  getModalConfirmApi,
  getRegexScriptsApi,
} from './adapters/spindle-extras.js';
import { normalizeSettingsPatch } from './state/settings-store.js';
import { consumeOwnChatChange } from './state/own-chat-change.js';
import { consumeOwnCharacterEdit, expectCharacterEdit } from './state/own-character-edit.js';
import { consumeIfOurWrite } from './state/recent-writes.js';
import {
  invalidateRenderMcpForChat,
  invalidateRenderMcpForMessage,
} from './state/render-mcp-cache.js';
import { invalidateMacroInterceptorForChat } from './state/macro-interceptor-cache.js';
import { scheduleStateChangedRefresh as scheduleDebouncedRefresh } from './state/state-changed-debouncer.js';
import {
  logStore,
  loadPersistedLogState,
  persistLogState,
  isLogThreshold,
} from './log/store.js';
import { resolveAlertDismissal } from './interpreter/alert-bridge.js';
import { resolvePickResolution } from './interpreter/pick-bridge.js';
import { userIdAls, currentUserId } from './interpreter/runtime/als.js';
import { checkHostVersion, type HostVersionCheckResult } from './util/version-check.js';
import { decodeModuleCharx } from './core/charx/index.js';
import { decodeRisum } from './core/risum/index.js';
import { risuModuleSchema } from './core/schemas/module.js';
import { guessMimeType, sniffImageMime } from './payload/import.js';
import {
  type ModuleEnvelope,
  deleteModule as deleteModuleFromStore,
  listModules as listModuleStore,
  pairModuleAssetsForUpload,
  readEnvelope as readModuleEnvelope,
  writeEnvelope as writeModuleEnvelope,
  readGlobalModuleIds,
  writeGlobalModuleIds,
  readGlobalModuleArtifacts,
  writeGlobalModuleArtifacts,
} from './state/modules-store.js';
import { registerLumiagentPhoneline } from './lumiagent-phoneline.js';

const EXTENSION_VERSION = '0.1.0';

// Mirrored from `spindle.json minimum_lumiverse_version`. Lumi may not enforce
// the manifest field at load time, so we re-check at runtime and nag the user.
const MINIMUM_LUMIVERSE_VERSION = '1.0.0';

// ALS-backed user attribution: each event handler runs its body inside a
// `userIdAls.run(userId, ...)` frame, so `currentUserId()` returns the firing
// event's user across awaits without losing it to concurrent peer dispatches.
// No fallback to module-global `activeUserId`: outside an ALS frame the log
// entry is system-tagged (null) rather than mis-attributed to the last user.
function logUid(): string | null {
  return currentUserId() ?? null;
}

// Wraps a Spindle event handler so its body executes under the firing user's
// ALS frame. System events without a userId run unwrapped (currentUserId
// stays null, so log entries get tagged null = system).
function userScoped(
  handler: (raw: unknown, userId: string | undefined) => Promise<void>,
): (raw: unknown, userId: string | undefined) => Promise<void> {
  return (raw, userId) =>
    userId
      ? userIdAls.run(userId, () => handler(raw, userId))
      : handler(raw, userId);
}

const log = {
  error(msg: string): void {
    spindle.log.error(`[lumirealm] ${msg}`);
    logStore.push('error', 'backend', msg, logUid());
  },
  warn(msg: string): void {
    if (logStore.shouldEmit('warn')) spindle.log.warn(`[lumirealm] ${msg}`);
    logStore.push('warn', 'backend', msg, logUid());
  },
  info(msg: string): void {
    if (logStore.shouldEmit('info')) spindle.log.info(`[lumirealm] ${msg}`);
    logStore.push('info', 'backend', msg, logUid());
  },
  debug(msg: string): void {
    if (logStore.shouldEmit('debug')) spindle.log.info(`[lumirealm] ${msg}`);
    logStore.push('debug', 'backend', msg, logUid());
  },
  trace(msg: string): void {
    if (logStore.shouldEmit('trace')) spindle.log.info(`[lumirealm] ${msg}`);
    logStore.push('trace', 'backend', msg, logUid());
  },
  /** @deprecated Alias for `debug`. */
  verbose(msg: string): void {
    if (logStore.shouldEmit('debug')) spindle.log.info(`[lumirealm] ${msg}`);
    logStore.push('debug', 'backend', msg, logUid());
  },
  /** @deprecated Alias for `info`. */
  always(msg: string): void {
    if (logStore.shouldEmit('info')) spindle.log.info(`[lumirealm] ${msg}`);
    logStore.push('info', 'backend', msg, logUid());
  },
};

log.info(`backend boot: version=${EXTENSION_VERSION} features=[lorebook-cache,worldbook-events]`);

// Lumi may not enforce manifest minimum_lumiverse_version, so we re-check at
// runtime and nag via get_cards handshake (mirrors Hone's pattern).
let hostVersionCheck: HostVersionCheckResult | null = null;
void (async () => {
  let backend: string | null = null;
  let frontend: string | null = null;
  try {
    backend = await spindle.version.getBackend();
  } catch (err) {
    log.warn(`spindle.version.getBackend() failed: ${errMsg(err)}`);
  }
  try {
    frontend = await spindle.version.getFrontend();
  } catch (err) {
    log.warn(`spindle.version.getFrontend() failed: ${errMsg(err)}`);
  }
  hostVersionCheck = checkHostVersion(backend, MINIMUM_LUMIVERSE_VERSION);
  const tag = hostVersionCheck.needsUpdate ? 'WARN' : 'ok';
  log.info(
    `host-version: lumiverse backend=${backend ?? 'unknown'} frontend=${frontend ?? 'unknown'} min=${MINIMUM_LUMIVERSE_VERSION} ${tag}`,
  );
  if (hostVersionCheck.needsUpdate) log.warn(hostVersionCheck.message);
})();

void initPermissions(log);

subscribeToMissingChanges((missing) => {
  const purposes: Record<string, string> = {};
  for (const p of missing) purposes[p] = PERMISSION_PURPOSE[p] ?? p;
  for (const userId of capturedUserIds) {
    try {
      spindle.sendToFrontend({
        type: 'notify_missing_permissions',
        missing,
        purposes,
      }, userId);
    } catch (err) {
      log.warn(`permissions.changed: sendToFrontend failed userId=${userId}: ${errMsg(err)}`);
    }
  }
  if (missing.length > 0) {
    log.warn(`permissions.changed: broadcast notify_missing_permissions to ${capturedUserIds.size} user(s) missing=[${missing.join(',')}]`);
  } else {
    log.info(`permissions.changed: all required perms granted, broadcast empty set to ${capturedUserIds.size} user(s) to auto-dismiss`);
  }
});

function broadcastBridgeStatus(payload: {
  offline: boolean;
  missingPermissions: readonly string[];
  forCaller?: string;
}): void {
  for (const userId of capturedUserIds) {
    try {
      spindle.sendToFrontend({ type: 'notify_bridge_status', ...payload }, userId);
    } catch (err) {
      log.warn(`bridge_status: sendToFrontend failed userId=${userId}: ${errMsg(err)}`);
    }
  }
}

// Probes lumiagent.phoneline_probe and returns the parsed missing-perms list
// when the host inheritance check rejects. Returns null on success or when
// the endpoint is not registered (LumiAgent absent), so the caller does not
// fire a banner in those cases.
async function probeLumiagentBridge(): Promise<readonly string[] | null> {
  try {
    await spindle.rpcPool.read('lumiagent.phoneline_probe');
    return null;
  } catch (err) {
    const message = (err as Error).message;
    const m = /requires requester "[^"]+" to inherit owner "[^"]+" permissions: ([^]+?)$/.exec(message);
    if (!m) return null;
    const perms = m[1]!.split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
    return perms.length > 0 ? perms : null;
  }
}

// On any permission change in this extension, probe the LumiAgent bridge to
// surface a banner immediately rather than waiting for LumiAgent to dial in.
// Symmetric to LumiAgent's own re-dial-on-perm-change behaviour.
subscribeToMissingChanges(() => {
  void (async () => {
    const missing = await probeLumiagentBridge();
    if (missing && missing.length > 0) {
      log.warn(`permissions.changed: lumiagent bridge probe failed, LumiRealm missing=[${missing.join(',')}]`);
      broadcastBridgeStatus({
        offline: true,
        missingPermissions: missing,
        forCaller: 'lumiagent',
      });
    } else {
      log.info(`permissions.changed: lumiagent bridge probe ok (or endpoint absent), clearing any banner`);
      broadcastBridgeStatus({ offline: false, missingPermissions: [] });
    }
  })();
});

// Without this guard any rejection from a card's Lua bridge call kills the worker.
{
  const proc: { on?: (ev: string, cb: (...a: unknown[]) => void) => void } | undefined =
    (globalThis as { process?: { on?: (ev: string, cb: (...a: unknown[]) => void) => void } }).process;
  // Route to spindle.log only, not logStore: these fire outside any ALS frame
  // so the message would be tagged null (visible in every user's export). The
  // operator sees the error via Lumi server logs.
  proc?.on?.('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    try { spindle.log.error(`[lumirealm] unhandledRejection (suppressed): ${msg.slice(0, 1200)}`); } catch { /* */ }
  });
  proc?.on?.('uncaughtException', (err: unknown) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    try { spindle.log.error(`[lumirealm] uncaughtException (suppressed): ${msg.slice(0, 1200)}`); } catch { /* */ }
  });
}

function modulesByNamespaceFromCard(card: StoredRisuCard): Readonly<Record<string, readonly string[]>> | null {
  const extra = card.risuPayload.extra as { modules_by_namespace?: unknown } | undefined;
  const raw = extra?.modules_by_namespace;
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, readonly string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((s) => typeof s === 'string')) {
      out[k] = v as readonly string[];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Risu macro compatibility does not register aliases with Lumi's MacroRegistry.
// The macroInterceptor resolves supported raw names through our evaluator before
// Lumi considers its native registry; display/bg-html resolve in-worker.

const variableState = new VariableStateStore();

const toggleState = new ToggleStateStore();

function scheduleStateChangedRefresh(chatId: string, userId: string | undefined): void {
  log.debug(`scheduleStateChangedRefresh: scheduling for chat=${chatId}`);
  scheduleDebouncedRefresh(
    chatId,
    async () => {
      const active = activeCardByChat.get(chatId);
      if (!active) {
        log.debug(`scheduleStateChangedRefresh: skipped (no active card) chat=${chatId}`);
        return;
      }
      const t0 = Date.now();
      // Body content resolves at render time via the 'render' MCP origin.
      // Var changes invalidate the render-MCP cache (per CHAT_CHANGED) and
      // Lumi's per-touchedVars displayRegexContentCache, which together
      // re-fetch only the affected bubbles. No bake walk here.
      invalidateRenderMcpForChat(chatId);
      invalidateMacroInterceptorForChat(chatId);
      await refreshBgHtml(active, chatId, userId);
      await refreshVariables(active, chatId, userId);
      log.debug(`scheduleStateChangedRefresh: completed chat=${chatId} elapsed=${Date.now() - t0}ms`);
    },
    (err) => log.error(`scheduleStateChangedRefresh: refresh threw chat=${chatId}: ${errMsg(err)}`),
  );
}

function makeStateChangedCallback(chatId: string, userId: string | undefined): () => void {
  return () => scheduleStateChangedRefresh(chatId, userId);
}

// Per-user settings cache. Defaults to DEFAULT_SETTINGS until first read,
// so Lua dispatches before `request_settings` arrives fall back gracefully.



// Tracks which userIds have already been bootstrapped by `captureUserId`,
// so the settings preload + orphan-review prompt fire once per session.
const capturedUserIds = new Set<string>();

const settingsService = createSettingsService({ userStorage, send, log, errMsg });
const getSettingsForUser = settingsService.getSettingsForUser;
const getCachedSettingsSync = settingsService.getCachedSettingsSync;
const applySettingsPatch = settingsService.applySettingsPatch;
const makeAuxDebugCapture = settingsService.makeAuxDebugCapture;
const listConnectionsForUser = settingsService.listConnectionsForUser;
const activeCardByChat = new Map<string, ActiveCard>();
// Tracks the last chat each user opened so a page-refresh (SETTINGS_UPDATED
// dedup'd on same value) can repaint bg-html + portal state.
const lastActiveChatByUser = new Map<string, string>();
// characterIds are Lumi-wide unique UUIDs, so these maps don't need an
// ownerUserId stamp. Their entries cache server-side derived data (compiled
// trigger AsyncFunction bodies, world-book-id snapshots for the cascade).
const compiledByCharacter = new Map<string, readonly CompiledTriggerEntry[]>();
const worldBookIdsByCharacter = new Map<string, readonly string[]>();

function journalStorage(): JournalStorage {
  return spindle.userStorage as unknown as JournalStorage;
}

const consentApi = createConsentApi({ send, log });
const requestConsent = consentApi.requestConsent;
const pendingConsents = consentApi.pendingConsents;

const queueModalConfirm = makeQueueModalConfirm({ getModalConfirmApi, log, errMsg });

const deleteCardByChar = makeDeleteCardByChar({
  clearLumirealm: (charId, userId) => clearLumirealm(charactersApi(), charId, userId),
  activeCardByChat,
  compiledByCharacter,
  variableState,
  toggleState,
  listCards,
  pushCards,
  onActiveChatEvicted: dropPromptRegexOwnershipForChat,
  log,
});

const orphanDetectBuilders = createOrphanDetectBuilders({
  journalStorage,
  listLumirealmCharacters: async (userId) => {
    const entries = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return entries.map((e) => ({
      character: { id: e.character.id, image_id: e.character.image_id ?? null },
      data: e.data,
    }));
  },
  listModuleStore: (userId) => listModuleStore(moduleStorage(), userId),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  log,
  errMsg,
});
const buildOrphanDetectDeps = orphanDetectBuilders.buildOrphanDetectDeps;
const buildOrphanDetectDepsExcluding = orphanDetectBuilders.buildOrphanDetectDepsExcluding;
const backfillImageJournalIfMissing = orphanDetectBuilders.backfillImageJournalIfMissing;
const deleteImageIds = orphanDetectBuilders.deleteImageIds;

const orphanOrchestrator = createOrphanOrchestrator({
  imagesApi: spindle.images
    ? { list: (opts) => spindle.images.list(opts as never) as never }
    : null,
  regexApi: getRegexScriptsApi(),
  listLumirealmCharacterIds: async (userId) => {
    const entries = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return entries.filter((e) => e.data !== null).map((e) => e.character.id);
  },
  listModuleIds: async (userId) => {
    const ms = await listModuleStore(moduleStorage(), userId);
    return ms.map((m) => m.id);
  },
  characterExists: async (userId, id) => {
    try {
      const c = await spindle.characters.get(id, userId);
      return c !== null;
    } catch {
      return false;
    }
  },
  moduleExists: async (userId, id) => {
    try {
      const env = await readModuleEnvelope(moduleStorage(), userId, id);
      return env !== null;
    } catch {
      return false;
    }
  },
  listImageJournalCharacterIds: (userId) => listImageJournalCharacterIds(journalStorage(), userId),
  readImageJournalFile: (userId, characterId) => readImageJournalFile(journalStorage(), userId, characterId),
  listModuleImageJournalIds: (userId) => listModuleImageJournalIds(journalStorage(), userId),
  readModuleImageJournalFile: (userId, moduleId) => readModuleImageJournalFile(journalStorage(), userId, moduleId),
  clearImageJournal: async (userId, characterId) => { await clearImageJournal(journalStorage(), userId, characterId); },
  clearModuleImageJournal: async (userId, moduleId) => { await clearModuleImageJournal(journalStorage(), userId, moduleId); },
  buildOrphanDetectDeps,
  countCharacterRepair: async (userId) => {
    const entries = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    const liveModuleIds = new Set((await listModuleStore(moduleStorage(), userId)).map((m) => m.id));
    let charactersToRetranslate = 0;
    let modulesToReattach = 0;
    let danglingModuleRefs = 0;
    for (const e of entries) {
      if (!e.data) continue;
      charactersToRetranslate += 1;
      const ids = e.data.user_overrides.attached_module_ids ?? [];
      for (const id of ids) {
        if (liveModuleIds.has(id)) modulesToReattach++;
        else danglingModuleRefs++;
      }
    }
    return { charactersToRetranslate, modulesToReattach, danglingModuleRefs };
  },
  log,
  errMsg,
});

const detectDeletedWhileOff = (userId: string) => orphanOrchestrator.detectDeletedWhileOff(userId);
const scanOrphanedImages = (userId: string) => orphanOrchestrator.scanOrphanedImages(userId);
const sweepOrphanModuleRegex = (userId: string) => orphanOrchestrator.sweepOrphanModuleRegex(userId);
const listStaleCharRegexIds = (userId: string) => orphanOrchestrator.listStaleCharRegexIds(userId);
const deleteRegexIds = (userId: string, ids: readonly string[]) => orphanOrchestrator.deleteRegexIds(userId, ids);
const clearDeadJournals = (userId: string) => orphanOrchestrator.clearDeadJournals(userId);

const captureUserId = makeCaptureUserId({
  capturedUserIds,
  getSettingsForUser,
  seedGlobalModules: async (uid) => {
    setGlobalModuleIdsCache(uid, await readGlobalModuleIds(moduleStorage(), uid));
  },
  // Trampolines: massMigrations is declared further down, this closure resolves it at call time.
  runMassModuleMigrationIfNeeded: (uid) => massMigrations.runMassModuleMigrationIfNeeded(uid),
  runMassCharacterMigrationIfNeeded: (uid) => massMigrations.runMassCharacterMigrationIfNeeded(uid),
  runRetiredMacroMigrationIfNeeded: (uid) => massMigrations.runRetiredMacroMigrationIfNeeded(uid),
  runVarScopeMigrationIfNeeded: (uid) => massMigrations.runVarScopeMigrationIfNeeded(uid),
  notifyMissingPermsForUser: (userId) => {
    const missing = getMissingPermissions();
    const purposes: Record<string, string> = {};
    for (const p of missing) purposes[p] = PERMISSION_PURPOSE[p] ?? p;
    try {
      spindle.sendToFrontend({ type: 'notify_missing_permissions', missing, purposes }, userId);
    } catch (err) {
      log.warn(`captureUserId.notify: sendToFrontend failed userId=${userId}: ${errMsg(err)}`);
    }
  },
  log,
  errMsg,
});


const scanRepairTargets = (userId: string) => orphanOrchestrator.scanRepairTargets(userId);


// JSC's incremental GC leaves upload-pipeline garbage (handoff, decoded
// Uint8Arrays, IPC payloads) rooted for minutes without slack. Force a
// synchronous full collect after large uploads, ~50-200ms on multi-GiB
// heaps, no-op when Bun.gc is unavailable.

const pendingImportCompletions = new Map<string, PendingImportCompletion>();

// Tracks asset-upload-bearing operations (card import, module upload). Cleanup
// scan refuses to run while non-zero so an in-flight upload's not-yet-journaled
// IDs cannot be deleted as orphans.
let assetUploadsInFlight = 0;

const importCardOrchestrator = createImportCardOrchestrator({
  extensionVersion: EXTENSION_VERSION,
  userStorage,
  requestConsent,
  worldBookIdsByCharacter,
  pendingImportCompletions,
  enterAssetUpload: () => { assetUploadsInFlight++; },
  exitAssetUpload: () => { assetUploadsInFlight--; },
  // Trampolines for wiring declared further down.
  nudgeGc: (reason) => nudgeGc(reason),
  refreshRisuAssetMap: (charId, userId) => refreshRisuAssetMap(charId, userId),
  send,
  listCards,
  pushCards,
  toastFor,
  log,
  errMsg,
});
const importCardFromBytes = importCardOrchestrator.importCardFromBytes;

// True while applyRepair is running. Module attach/detach + drawer mutations
// gate against this so the snapshot-then-write loop in forceRetranslateAll
// can't be raced into silent data loss on user_overrides.
const repairInFlightByUser = new Set<string>();

// Per-character per-worker-boot dedupe, set on first migration check fire.
const translatorMigrationChecked = new Set<string>();

// Returns true and surfaces an error toast if a repair is in flight, so
// the caller should bail. Returns false if it's safe to proceed.
function blockedByRepair(userId: string | undefined, messageType: string): boolean {
  if (userId === undefined) return false;
  if (!repairInFlightByUser.has(userId)) return false;
  log.info(`${messageType}: blocked by in-flight repair for user=${userId}`);
  toastFor(
    userId,
    'warning',
    'A repair is in progress. Try again once it finishes.',
    { title: 'lumirealm' },
  );
  return true;
}

type OperationPhase = 'started' | 'progress' | 'done' | 'error';
function emitOperationProgress(
  userId: string,
  operationId: string,
  phase: OperationPhase,
  title: string,
  message: string,
  fraction: number | null,
  error?: string,
): void {
  send({
    type: 'operation_progress',
    operationId,
    phase,
    title,
    message,
    fraction,
    ...(error !== undefined ? { error } : {}),
  }, userId);
}



function userStorage(): UserStorageLike {
  return spindle.userStorage as unknown as UserStorageLike;
}

function send(msg: BackendToFrontend, userId: string | undefined): void {
  // Refuse broadcast on undefined: operator-scoped sendToFrontend without a
  // userId fans out to every connected user, leaking a single user's reply.
  if (userId === undefined) {
    log.error(`send: refusing to broadcast type=${msg.type} (no userId)`);
    return;
  }
  spindle.sendToFrontend(msg, userId);
}

function toastFor(
  userId: string | undefined,
  kind: 'success' | 'warning' | 'error' | 'info',
  message: string,
  options?: { title?: string; duration?: number },
): void {
  const t = spindle.toast as unknown as
    | Record<typeof kind, (m: string, o: { title?: string; duration?: number; userId?: string }) => void>
    | undefined;
  if (!t) return;
  if (userId === undefined) {
    log.warn(`toastFor(broadcast): no userId for kind=${kind}, fanning out to all users`);
    t[kind](message, options ?? {});
    return;
  }
  t[kind](message, { ...(options ?? {}), userId });
}


const logStateLoadedFor = new Set<string>();
async function ensureLogStateLoaded(userId: string): Promise<void> {
  if (logStateLoadedFor.has(userId)) return;
  await loadPersistedLogState(userStorage(), userId);
  logStateLoadedFor.add(userId);
}
async function listCards(userId: string | undefined): Promise<readonly CardSummary[]> {
  const t0 = Date.now();
  log.debug(`listCards: start userId=${userId ?? '<none>'}`);
  if (userId === undefined) {
    log.info(`listCards: userId not yet captured, returning empty`);
    return [];
  }
  const entries = await listLumirealmCharacters(charactersApi(), userId, {
    paginate: true,
  });
  const lang = TRANSLATE_TARGET_LANG;
  const recency = await readCharacterRecency(userStorage(), userId);
  const summaries: CardSummary[] = entries.map((e) => {
    const tx = e.data.translations?.[lang]?.name;
    const lastOpened = recency.seen[e.character.id];
    return {
      character_id: e.character.id,
      character_name: e.character.name,
      ...(tx !== undefined ? { translated_character_name: tx } : {}),
      translator_version: e.data.translator_version,
      uses_lua: e.data.payload.requires.lua,
      stored_at: e.data.imported_at,
      ...(lastOpened !== undefined ? { last_opened_at: lastOpened } : {}),
    };
  });
  // Recently opened first, then never-opened by import time. Sorting purely by
  // import time buried whatever you actually use behind the newest download.
  summaries.sort((a, b) =>
    (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0) || b.stored_at - a.stored_at);
  log.debug(`listCards: done count=${summaries.length} elapsed=${Date.now() - t0}ms`);
  return summaries;
}

function pushCards(cards: readonly CardSummary[], userId: string | undefined): void {
  send({ type: 'cards_updated', cards }, userId);
}



// spindle.on(event, handler) survives syncTriggers() reloads and receives
// every event fired via eventBus.emit(type, payload, userId) for this user.

interface LifecycleEventPayload {
  readonly chatId?: string;
  readonly chat?: { readonly id?: string; readonly character_id?: string };
  readonly characterId?: string;
  readonly character_id?: string;
}

function extractIds(payload: unknown): {
  chatId: string | null;
  characterId: string | null;
} {
  const p = payload as LifecycleEventPayload;
  const chatId = p.chatId ?? p.chat?.id ?? null;
  const characterId = p.characterId ?? p.character_id ?? p.chat?.character_id ?? null;
  return { chatId, characterId };
}

function charactersApi(): SpindleCharactersApi {
  return spindle.characters as unknown as SpindleCharactersApi;
}










// Per-chat memo of the last bg-html signature, dedupes redundant sends across the SETTINGS_UPDATED + CHAT_CHANGED + GENERATION_* fan-out on chat-open.
const lastSentBgHtmlByChat = new Map<string, string>();


function dumpPayload(raw: unknown): string {
  try { return JSON.stringify(raw).slice(0, 400); } catch { return '<unstringifiable>'; }
}

// Capture userId from every event callback so operator-scoped Spindle calls
// succeed before any frontend message arrives.

// Decoupled from bg-html paint so empty-bg cards activate.
const FE_DISPLAY_ENABLED = (() => {
  const v = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env?.LUMIREALM_FE_DISPLAY;
  return v !== '0' && v !== 'false';
})();

const PROMPT_REGEX_ENV = (() => {
  const v = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env?.LUMIREALM_PROMPT_REGEX;
  return v !== '0' && v !== 'false';
})();

const PROMPT_REGEX_RUNNER_AVAILABLE = isPromptRegexRunnerAvailable();

// The host-skip side of the apply<=>skip invariant rides spindle.promptRegex.setOwnedChats.
// A host that exposes backendProcesses but predates that plumbing would never be told to skip,
// so claiming authority there would double-apply (host pass + inline pass). Require both.
const PROMPT_REGEX_HOST_OWNERSHIP_AVAILABLE = typeof (
  spindle as unknown as { promptRegex?: { setOwnedChats?: unknown } }
).promptRegex?.setOwnedChats === 'function';

const PROMPT_REGEX_ACTIVE =
  PROMPT_REGEX_ENV && PROMPT_REGEX_RUNNER_AVAILABLE && PROMPT_REGEX_HOST_OWNERSHIP_AVAILABLE;

if (PROMPT_REGEX_ENV && !PROMPT_REGEX_RUNNER_AVAILABLE) {
  log.warn(
    'Inline prompt regex is enabled (LUMIREALM_PROMPT_REGEX) but spindle.backendProcesses is unavailable ' +
      'on this host; declining prompt-regex ownership so the host keeps running its own sandboxed pass. ' +
      'Upgrade Lumiverse to enable inline prompt regex in a killable subprocess.',
  );
} else if (PROMPT_REGEX_ENV && !PROMPT_REGEX_HOST_OWNERSHIP_AVAILABLE) {
  log.warn(
    'Inline prompt regex is enabled (LUMIREALM_PROMPT_REGEX) and backendProcesses is available, but ' +
      'spindle.promptRegex.setOwnedChats is missing on this host; declining prompt-regex ownership so the host ' +
      'keeps its own pass (a host that cannot be told to skip would otherwise double-apply). Upgrade Lumiverse to ' +
      'enable inline prompt regex.',
  );
}

const promptRegexRunnerClient = PROMPT_REGEX_ACTIVE
  ? createPromptRegexRunnerClient({ log, errMsg })
  : null;

const promptRegexOwnedByUser = new Map<string, string>();
let promptRegexOwnedSnapshot = '';

function syncPromptRegexOwnedChats(): void {
  if (!PROMPT_REGEX_ACTIVE) return;
  const owned = new Set<string>();
  for (const chatId of promptRegexOwnedByUser.values()) owned.add(chatId);
  const next = [...owned].sort().join(' ');
  if (next === promptRegexOwnedSnapshot) return;
  promptRegexOwnedSnapshot = next;
  const api = (spindle as unknown as { promptRegex?: { setOwnedChats?: (ids: string[]) => void } }).promptRegex;
  if (!api?.setOwnedChats) return;
  try {
    api.setOwnedChats([...owned]);
  } catch (err) {
    log.warn(`syncPromptRegexOwnedChats: ${(err as Error).message}`);
  }
}

function dropPromptRegexOwnershipForChat(chatId: string): void {
  if (!PROMPT_REGEX_ACTIVE) return;
  let dropped = false;
  for (const [uid, owned] of promptRegexOwnedByUser) {
    if (owned === chatId) {
      promptRegexOwnedByUser.delete(uid);
      dropped = true;
    }
  }
  if (dropped) syncPromptRegexOwnedChats();
}

function isPromptRegexOwnedChat(chatId: string): boolean {
  for (const owned of promptRegexOwnedByUser.values()) {
    if (owned === chatId) return true;
  }
  return false;
}

// Fire-and-forget: chat-open must not block on a storage write, and a lost
// timestamp only costs picker ordering.
let recencyWriteChain: Promise<void> = Promise.resolve();
async function touchCharacterRecency(
  characterId: string,
  userId: string | undefined,
): Promise<void> {
  if (userId === undefined) return;
  // Serialised, otherwise two rapid chat switches read the same map and the
  // second write drops the first character's timestamp.
  recencyWriteChain = recencyWriteChain.then(async () => {
    try {
      const cur = await readCharacterRecency(userStorage(), userId);
      if (cur.seen[characterId] !== undefined
        && Date.now() - cur.seen[characterId]! < 60_000) return;
      await writeCharacterRecency(userStorage(), userId, touchRecency(cur, characterId, Date.now()));
    } catch (err) {
      log.debug(`touchCharacterRecency: ${errMsg(err)}`);
    }
  });
  return recencyWriteChain;
}

function sendSetActiveChat(
  activeChatId: string | null,
  activeCharacterId: string | null,
  userId: string | undefined,
): void {
  try {
    send({ type: 'set_active_chat', chatId: activeChatId, characterId: activeCharacterId }, userId);
  } catch (err) {
    log.warn(`sendSetActiveChat: ${(err as Error).message}`);
  }
  if (activeCharacterId !== null) void touchCharacterRecency(activeCharacterId, userId);
  if (PROMPT_REGEX_ACTIVE && userId !== undefined) {
    const nowOwned = activeChatId !== null;
    const prevOwned = promptRegexOwnedByUser.get(userId);
    if (nowOwned) {
      if (prevOwned !== activeChatId) {
        promptRegexOwnedByUser.set(userId, activeChatId!);
        // Prove the killable runner can spawn BEFORE relying on the host-skip we just
        // declared. The skip is now in effect; if the runner can't come up, the inline
        // pass can't run and the prompt would ship un-regex'd, so drop the claim (the host
        // resumes its own pass). Fire-and-forget — chat-open must not block on spawn.
        const claimedChat = activeChatId!;
        const claimingUser = userId;
        void promptRegexRunnerClient?.warmUp(claimingUser).then((ok) => {
          if (ok) return;
          if (promptRegexOwnedByUser.get(claimingUser) !== claimedChat) return;
          log.error(
            `prompt-regex: runner warm-up failed for chat=${claimedChat}; dropping ownership so the host resumes its own prompt-regex pass.`,
          );
          promptRegexOwnedByUser.delete(claimingUser);
          syncPromptRegexOwnedChats();
        });
      }
    } else if (prevOwned !== undefined) {
      promptRegexOwnedByUser.delete(userId);
    }
    syncPromptRegexOwnedChats();
  }
}

const nudgeGc = makeNudgeGc(log, errMsg);
const refreshPersonaImage = makeRefreshPersonaImage({ log, errMsg });
const seedAuthorsNoteFromDepthPrompt = makeSeedAuthorsNoteFromDepthPrompt({ log, errMsg });
const maybeFinalizeImport = makeMaybeFinalizeImport({
  pendingImportCompletions,
  send,
  listCards,
  pushCards,
  log,
  errMsg,
});

const activeCardLoader = createActiveCardLoader({
  extensionVersion: EXTENSION_VERSION,
  currentCharacterSchemaVersion: CURRENT_CHARACTER_SCHEMA_VERSION,
  activeCardByChat,
  worldBookIdsByCharacter,
  translatorMigrationChecked,
  repairInFlightByUser,
  getMissingPermissions,
  readLumirealm: (characterId, userId) => readLumirealm(charactersApi(), characterId, userId),
  preValidateRequires,
  buildVersionError: (missing) => new RisuCompatVersionError(missing, EXTENSION_VERSION),
  loadAttachedModulesForRuntime: (userId, ids) => loadAttachedModulesForRuntime(userId, ids),
  buildSyntheticStoredCard,
  modulesByNamespaceFromCard,
  setActiveAssetIndexes,
  setActiveScriptstateDefaults,
  setActiveModulesByNamespace,
  clearActiveModulesByNamespace,
  setActiveLorebook,
  fetchLorebookForCharacter: (worldBookIds, userId) => fetchLorebookForCharacter(worldBookIds, userId),
  hasActiveLorebookForCharacter,
  getActiveLorebookByCharacter,
  setActiveCharacterImage: (chatId, url) => setActiveCharacterImage(chatId, url ?? ''),
  imageUrlFromId,
  backfillImageJournalIfMissing: (charId, avatarId, card, userId) =>
    backfillImageJournalIfMissing(charId, avatarId, card, userId),
  refreshPersonaImage: (userId) => refreshPersonaImage(userId),
  seedAuthorsNoteFromDepthPrompt: (chatId, userId, ext) =>
    seedAuthorsNoteFromDepthPrompt(chatId, userId, ext),
  // Forward-bound: migrationsRunner is wired below, this trampoline calls into it once available.
  runCharacterMigration: (charId, charName, userId, env, opts) =>
    migrationsRunner.runCharacterMigration(charId, charName, userId, env, opts),
  toastFor,
  log,
  errMsg,
});
const ensureActiveCardForChat = activeCardLoader.ensureActiveCardForChat;

const readonlyResolver = createReadonlyResolver({
  activeCardByChat,
  getCachedSettingsSync,
  modulesByNamespaceFromCard,
  log,
  errMsg,
});
const resolveReadonly = readonlyResolver.resolve;
const resolveReadonlyMany = readonlyResolver.resolveMany;

// Page size 200 matches Lumi's server-side clamp. Module-installed rows live
// at character scope too, so we exclude them by metadata._risu.module_id.
async function listLiveCharacterCrossRuleRules(
  characterId: string,
  userId: string,
): Promise<readonly { replace_string: string }[]> {
  const regexApi = getRegexScriptsApi();
  if (!regexApi?.list) {
    throw new Error('spindle.regex_scripts.list is not available on this host');
  }
  const PAGE_SIZE = 200;
  const out: { replace_string: string }[] = [];
  let offset = 0;
  while (true) {
    const page = await regexApi.list({ userId, limit: PAGE_SIZE, offset });
    if (!Array.isArray(page.data) || page.data.length === 0) break;
    for (const r of page.data) {
      const row = r as {
        scope?: unknown;
        scope_id?: unknown;
        disabled?: unknown;
        replace_string?: unknown;
        metadata?: { _risu?: { module_id?: unknown } };
      };
      if (row.scope !== 'character') continue;
      if (row.scope_id !== characterId) continue;
      if (row.disabled === true) continue;
      const mid = row.metadata?._risu?.module_id;
      if (typeof mid === 'string' && mid.length > 0) continue;
      if (typeof row.replace_string === 'string') {
        out.push({ replace_string: row.replace_string });
      }
    }
    offset += page.data.length;
    if (typeof page.total === 'number' && offset >= page.total) break;
  }
  return out;
}

const bgHtmlRefresher = createBgHtmlRefresher({
  resolveReadonly,
  lastSentBgHtmlByChat,
  listLiveCharacterCrossRuleRules,
  send,
  log,
  errMsg,
});
const refreshBgHtml = bgHtmlRefresher.refresh;

const applySvgRasterIndex = createApplySvgRasterIndex({
  updateLumirealm: (charId, userId, fn) => updateLumirealm(charactersApi(), charId, userId, fn),
  send,
  appendImageIdsToJournal: (userId, charId, ids) => appendImageIdsToJournal(journalStorage(), userId, charId, ids),
  activeCardByChat,
  ensureActiveCardForChat,
  invalidateRenderMcpForChat,
  invalidateMacroInterceptorForChat,
  onActiveChatEvicted: dropPromptRegexOwnershipForChat,
  refreshBgHtml,
  log,
  errMsg,
});

const TRANSLATE_TARGET_LANG = 'en';

const variablesTogglesService = createVariablesTogglesService({
  translateLang: TRANSLATE_TARGET_LANG,
  variableState,
  toggleState,
  readLumirealm: (charId, userId) => readLumirealm(charactersApi(), charId, userId),
  readAttachedModuleEnvelopes: (userId, ids) => readAttachedModuleEnvelopes(userId, ids),
  ensureActiveCardForChat,
  refreshBgHtml,
  send,
  pushDisplaySnapshot: (active, chatId, userId, vars) => {
    if (!FE_DISPLAY_ENABLED) return;
    void assembleDisplaySnapshot(
      {
        modulesByNamespaceFromCard,
        legacyMediaFindings: (uid) => getCachedSettingsSync(uid).legacyMediaFindings,
        getCompiledLibraries: (a) => {
          const cid = a.card.character_id;
          let compiled = compiledByCharacter.get(cid);
          if (!compiled) {
            try {
              compiled = prepareTriggers(a.card.risuPayload, cid);
              compiledByCharacter.set(cid, compiled);
            } catch {
              compiled = [];
            }
          }
          return compiled.filter((e) => e.type === 'library');
        },
      },
      active,
      chatId,
      userId,
      vars,
    )
      .then((snapshot) => { send({ type: 'display_snapshot', snapshot }, userId); })
      .catch((err) => { log.warn(`pushDisplaySnapshot: assemble failed chat=${chatId}: ${errMsg(err)}`); });
  },
  log,
  errMsg,
});
const refreshVariables = variablesTogglesService.refreshVariables;
const writeLocalVariable = variablesTogglesService.writeLocalVariable;
const refreshToggleDefinitions = variablesTogglesService.refreshToggleDefinitions;
const writeToggleValue = variablesTogglesService.writeToggleValue;

const triggerDispatcher = createTriggerDispatcher({
  compiledByCharacter,
  getCachedSettingsSync,
  makeStateChangedCallback,
  makeAuxDebugCapture,
  resolveReadonly,
  ensureActiveCardForChat,
  refreshBgHtml,
  refreshVariables,
  toastFor,
  log,
  errMsg,
});
const runBinding = triggerDispatcher.runBinding;
const dispatchManualTrigger = triggerDispatcher.dispatchManualTrigger;
const dispatchButtonClick = triggerDispatcher.dispatchButtonClick;

const feDisplayShadowOptOut = new Set<string>();

createLumiInterceptors({
  activeCardByChat,
  lastActiveChatByUser,
  captureUserId,
  isFeDisplayAuthoritative: (chatId) => FE_DISPLAY_ENABLED && !feDisplayShadowOptOut.has(chatId),
  isPromptRegexAuthoritative: (chatId: string) => PROMPT_REGEX_ACTIVE && isPromptRegexOwnedChat(chatId),
  dispatchPromptRegex: (prebuilt, scripts, messages, userId) =>
    promptRegexRunnerClient
      ? promptRegexRunnerClient.dispatch(prebuilt, scripts, messages, userId)
      : Promise.resolve({ ok: false, changed: false, messages }),
  ensureActiveCardForChat,
  getCachedSettingsSync,
  modulesByNamespaceFromCard,
  resolveReadonly,
  resolveReadonlyMany,
  runMessageVarPass: (chatId, characterId, uid) => messageVarPass.run(chatId, characterId, uid),
  runBinding,
  log,
  errMsg,
}).registerAll();

// Strip msgs[0] when it's the greeting (non-user) so cached array sits in
// Risu frame, currentMessageIndex (also Risu-frame) indexes correctly.
const messagesCacheInflight = new Map<string, Promise<void>>();
async function refreshMessagesCache(chatId: string, _userId: string | undefined): Promise<void> {
  if (!chatId) return;
  const existing = messagesCacheInflight.get(chatId);
  if (existing) return existing;
  const task = (async () => {
    try {
      const raw = (await spindle.chat.getMessages(chatId)) as unknown as readonly Record<string, unknown>[];
      const arr = Array.isArray(raw) ? raw : [];
      const sliced = arr.length > 0 && arr[0] && arr[0].role !== 'user' ? arr.slice(1) : arr;
      const msgs = sliced.map((m) => {
        const role = m.role === 'user' ? ('user' as const) : ('assistant' as const);
        const content = typeof m.content === 'string' ? m.content : '';
        const sendDate = typeof m.send_date === 'number' ? m.send_date : null;
        const createdAt = typeof m.created_at === 'number' ? m.created_at : null;
        return { role, content, createdAt: sendDate ?? createdAt ?? 0 };
      });
      setCachedMessages(chatId, msgs);
    } catch (err) {
      log.warn(`refreshMessagesCache: chat=${chatId} failed: ${errMsg(err)}`);
    } finally {
      messagesCacheInflight.delete(chatId);
    }
  })();
  messagesCacheInflight.set(chatId, task);
  return task;
}

const messageVarPass = createMessageVarPass({
  stripMessageSetvars: readonlyResolver.stripMessageSetvars,
  refreshMessagesCache,
  invalidateRenderMcpForChat,
  invalidateMacroInterceptorForChat,
  log,
  errMsg,
});

// SETTINGS_UPDATED activeChatId fires on chat navigation. Warms the active-card cache and renders bg-html.
const lifecycleHandlers = createLifecycleEventHandlers({
  captureUserId,
  extractIds,
  dumpPayload,
  activeCardByChat,
  lastActiveChatByUser,
  lastSentBgHtmlByChat,
  compiledByCharacter,
  worldBookIdsByCharacter,
  variableState,
  toggleState,
  ensureActiveCardForChat,
  // Trampoline: characterModuleAttach is wired below, this defers the lookup to call time.
  invalidateActiveForCharacter: (characterId, userId) => characterModuleAttach.invalidateActiveForCharacter(characterId, userId),
  onActiveChatEvicted: dropPromptRegexOwnershipForChat,
  invalidateRenderMcpForChat,
  invalidateRenderMcpForMessage,
  invalidateMacroInterceptorForChat,
  invalidateListenEditPreload,
  refreshMessagesCache,
  invalidateMessagesCache: invalidateCachedMessages,
  clearActiveAssetIndexes,
  clearActiveCharacterImage,
  clearActiveScriptstateDefaults,
  clearActiveLorebook,
  clearVarOverlay,
  refreshPersonaImage: (userId) => refreshPersonaImage(userId),
  refreshBgHtml,
  refreshVariables,
  refreshToggleDefinitions,
  runBinding,
  runMessageVarPass: (chatId, characterId, userId) => messageVarPass.run(chatId, characterId, userId),
  generationEndedBindings: GENERATION_ENDED_BINDINGS,
  consumeOwnChatChange,
  consumeOwnCharacterEdit,
  consumeIfOurWrite,
  send,
  sendSetActiveChat,
  setChatStyleMode: (chatId, mode, userId) => {
    const setter = (spindle.chat as { setStyleMode?: (chatId: string, mode: 'bounded' | 'extension-relaxed', userId?: string) => Promise<void> }).setStyleMode;
    if (typeof setter !== 'function') return;
    setter.call(spindle.chat, chatId, mode, userId).catch((err: unknown) => {
      log.warn(`setChatStyleMode chat=${chatId} mode=${mode}: ${errMsg(err)}`);
    });
  },
  listCards,
  pushCards,
  deleteCardByChar,
  journalStorage,
  readImageJournalFile,
  clearImageJournal,
  buildLiveImageIdSet,
  buildOrphanDetectDepsExcluding,
  deleteImageIds,
  emitOperationProgress,
  chatsGet: (chatId, userId) => spindle.chats.get(chatId, userId) as Promise<{ character_id?: string } | null>,
  log,
  errMsg,
});

spindle.on('SETTINGS_UPDATED', userScoped(lifecycleHandlers.SETTINGS_UPDATED));
spindle.on('PERSONA_CHANGED', userScoped(lifecycleHandlers.PERSONA_CHANGED));
spindle.on('CHAT_CHANGED', userScoped(lifecycleHandlers.CHAT_CHANGED));
spindle.on('MESSAGE_SENT', userScoped(lifecycleHandlers.MESSAGE_SENT));
spindle.on('GENERATION_STARTED', userScoped(lifecycleHandlers.GENERATION_STARTED));
spindle.on('GENERATION_ENDED', userScoped(lifecycleHandlers.GENERATION_ENDED));
spindle.on('GENERATION_STOPPED', userScoped(lifecycleHandlers.GENERATION_STOPPED));
spindle.on('MESSAGE_SWIPED', userScoped(lifecycleHandlers.MESSAGE_SWIPED));
spindle.on('MESSAGE_EDITED', userScoped(lifecycleHandlers.MESSAGE_EDITED));
spindle.on('MESSAGE_DELETED', userScoped(lifecycleHandlers.MESSAGE_DELETED));
spindle.on('CHAT_DELETED', userScoped(lifecycleHandlers.CHAT_DELETED));
spindle.on('CHARACTER_DELETED', userScoped(lifecycleHandlers.CHARACTER_DELETED));
spindle.on('CHARACTER_CREATED', userScoped(lifecycleHandlers.CHARACTER_CREATED));
spindle.on('CHARACTER_EDITED', userScoped(lifecycleHandlers.CHARACTER_EDITED));
spindle.on('WORLD_BOOK_CHANGED', userScoped(lifecycleHandlers.WORLD_BOOK_CHANGED));
spindle.on('WORLD_BOOK_DELETED', userScoped(lifecycleHandlers.WORLD_BOOK_DELETED));
spindle.on('WORLD_BOOK_ENTRY_CHANGED', userScoped(lifecycleHandlers.WORLD_BOOK_ENTRY_CHANGED));
spindle.on('WORLD_BOOK_ENTRY_DELETED', userScoped(lifecycleHandlers.WORLD_BOOK_ENTRY_DELETED));

function moduleStorage(): import('./state/modules-store.js').UserStorageLike {
  return spindle.userStorage as unknown as import('./state/modules-store.js').UserStorageLike;
}

// Expose LumiRealm to LumiAgent via the phone-line protocol. One handler at
// `lumirealm.phoneline` answers describe, system_prompt, check_write, and
// the module_envelope surface ops. Forward-bound: charactersAttachedTo and
// invalidateActiveForCharacter are declared below; the callback only runs
// at runtime once they exist.
registerLumiagentPhoneline(
  spindle,
  moduleStorage,
  (msg) => spindle.log.info(msg),
  async (env, userId) => {
    const attached = await charactersAttachedTo(env.id, userId);
    for (const charId of attached) invalidateActiveForCharacter(charId, userId);
  },
  {
    mutateAssetIndex: (msg, userId) => mutateAssetIndex(msg as never, userId),
    attachModuleToCharacter: (cid, mid, uid) => attachModuleToCharacter(cid, mid, uid),
    detachModuleFromCharacter: (cid, mid, uid) => detachModuleFromCharacter(cid, mid, uid),
    writeToggleValue: (cid, key, val, uid) => writeToggleValue(cid, key, val, uid),
    writeLocalVariable: (cid, key, val, uid) => writeLocalVariable(cid, key, val, uid),
    setDefaultVariablesText: async (characterId, text, userId) => {
      const updated = await updateLumirealm(charactersApi(), characterId, userId, (cur) => {
        const {
          default_variables_text: _t,
          default_variables_overrides: _o,
          ...rest
        } = cur.user_overrides;
        void _t; void _o;
        const nextUO = {
          ...rest,
          ...(text !== null ? { default_variables_text: text } : {}),
        };
        return { ...cur, user_overrides: nextUO };
      });
      if (!updated) return { ok: false, reason: 'not a lumirealm character' };
      await pushViewerData(
        { source: { kind: 'character', characterId }, context: 'set_default_variables_text', userId },
        viewerPushDeps,
      );
      invalidateActiveForCharacter(characterId, userId);
      return { ok: true };
    },
  },
  broadcastBridgeStatus,
);

const moduleUploader = createModuleUploader({
  decodeRisum,
  decodeCharx: decodeModuleCharx,
  parseSchema: (data) => risuModuleSchema.safeParse(data) as never,
  newUuid: () => crypto.randomUUID(),
  requestConsent: (opts, userId) => requestConsent(opts, userId),
  pairAssets: pairModuleAssetsForUpload,
  guessMimeType,
  sniffImageMime,
  uploadImageOne: (input, userId) => {
    if (!spindle.images?.upload) {
      throw new Error('spindle.images.upload is unavailable,Lumi 0.9.6+ required.');
    }
    return spindle.images.upload(input, userId);
  },
  ...(typeof spindle.images?.uploadMany === 'function'
    ? {
        uploadImageMany: (items, opts) =>
          spindle.images.uploadMany(items as never, opts),
      }
    : {}),
  appendToJournal: (uid, moduleId, ids) =>
    appendModuleImageIdsToJournal(journalStorage(), uid, moduleId, ids),
  syncWorldBook: (env, uid) => syncModuleWorldBook(env, uid),
  writeEnvelope: async (uid, env) => { await writeModuleEnvelope(moduleStorage(), uid, env); },
  emitProgress: (frame, userId) => send(frame, userId),
  currentTranslatorSchemaVersion: CURRENT_MODULE_SCHEMA_VERSION,
  log,
  errMsg,
});

async function processModuleUpload(
  bytesIn: Uint8Array,
  fileName: string,
  userId: string,
): Promise<{ envelope: ModuleEnvelope }> {
  assetUploadsInFlight++;
  try {
    return await moduleUploader.upload(bytesIn, fileName, userId);
  } finally {
    assetUploadsInFlight--;
  }
}




const modulePushes = createModulePushes({
  translateLang: TRANSLATE_TARGET_LANG,
  readGlobalModuleIds: (userId) => readGlobalModuleIds(moduleStorage(), userId),
  readLumirealm: (charId, userId) => readLumirealm(charactersApi(), charId, userId),
  writeLumirealm: (charId, data, userId) => writeLumirealm(charactersApi(), charId, data, userId),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  writeModuleEnvelope: async (userId, env) => { await writeModuleEnvelope(moduleStorage(), userId, env); },
  listModuleStore: (userId) => listModuleStore(moduleStorage(), userId),
  listLumirealmCharacters: async (userId) => {
    const all = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return all.map((e) => ({ character: { id: e.character.id }, data: e.data }));
  },
  listCards,
  pushCards,
  send,
  log,
  errMsg,
});
const pushModules = modulePushes.pushModules;
const pushAttachedForCharacter = modulePushes.pushAttachedForCharacter;
const persistModuleTranslation = modulePushes.persistModuleTranslation;
const persistCharacterTranslation = modulePushes.persistCharacterTranslation;
const readAttachedModuleEnvelopes = modulePushes.readAttachedModuleEnvelopes;
const loadAttachedModulesForRuntime = modulePushes.loadAttachedModulesForRuntime;

const viewerAssembly = createViewerAssembly({
  readLumirealm: (characterId, userId) => readLumirealm(charactersApi(), characterId, userId),
  readModule: async (moduleId, userId) =>
    readModuleEnvelope(moduleStorage(), userId, moduleId) as unknown as Awaited<ReturnType<typeof readModuleEnvelope>> as never,
  fetchCharacter: async (characterId, userId) =>
    spindle.characters.get(characterId, userId) as unknown as { world_book_ids?: unknown } | null,
  fetchWorldBookMeta: async (wbId, userId) =>
    spindle.world_books.get(wbId, userId) as unknown as { name?: unknown } | null,
  listWorldBookEntries: (wbId, opts) => spindle.world_books.entries.list(wbId, opts),
  translateLang: TRANSLATE_TARGET_LANG,
  log,
  errMsg,
});



const worldBookOps = createWorldBookOps({
  // Forward-bound: characterModuleAttach is wired below, this trampoline calls into it once available.
  charactersAttachedTo: (moduleId, userId) => characterModuleAttach.charactersAttachedTo(moduleId, userId),
  send,
  log,
  errMsg,
});
void worldBookOps.archiveWorldBookIfEdited;
void worldBookOps.deleteModuleWorldBookEverywhere;

const assetTriggerMutate = createAssetTriggerMutate({
  readLumirealm: (charId, userId) => readLumirealm(charactersApi(), charId, userId),
  updateLumirealm: (charId, userId, fn) => updateLumirealm(charactersApi(), charId, userId, fn),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  writeModuleEnvelope: async (userId, env) => { await writeModuleEnvelope(moduleStorage(), userId, env); },
  pushModules,
  reclaimImageIds: async (imageIds, userId, context) => {
    const live = await buildLiveImageIdSet(orphanDetectBuilders.buildOrphanDetectDeps(userId));
    const safe = imageIds.filter((id) => !live.liveIds.has(id));
    const shielded = imageIds.length - safe.length;
    if (safe.length === 0) return { deleted: 0, shielded };
    const stats = await deleteImageIds(safe, userId, context);
    return { deleted: stats.deleted, shielded };
  },
  log,
  errMsg,
});
const refreshRisuAssetMap = assetTriggerMutate.refreshRisuAssetMap;
const mutateAssetIndex = assetTriggerMutate.mutateAssetIndex;
const mutateTriggerLua = assetTriggerMutate.mutateTriggerLua;

const characterModuleAttach = createCharacterModuleAttach({
  readLumirealm: (charId, userId) => readLumirealm(charactersApi(), charId, userId),
  updateLumirealm: (charId, userId, fn) => updateLumirealm(charactersApi(), charId, userId, fn),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  listLumirealmCharacters: async (userId) => {
    const all = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return all.map((e) => ({ character: { id: e.character.id }, data: e.data }));
  },
  addWorldBookToCharacter: (charId, wbId, userId) => worldBookOps.addWorldBookToCharacter(charId, wbId, userId),
  removeWorldBookFromCharacter: (charId, wbId, userId) => worldBookOps.removeWorldBookFromCharacter(charId, wbId, userId),
  dispatchModuleArtifactInstall: (charId, env, userId) => worldBookOps.dispatchModuleArtifactInstall(charId, env, userId),
  refreshRisuAssetMap,
  activeCardByChat,
  compiledByCharacter,
  lastSentBgHtmlByChat,
  variableState,
  toggleState,
  ensureActiveCardForChat,
  refreshToggleDefinitions,
  refreshBgHtml,
  send,
  onActiveChatEvicted: dropPromptRegexOwnershipForChat,
  log,
  errMsg,
});
const attachModuleToCharacter = characterModuleAttach.attachModuleToCharacter;
const detachModuleFromCharacter = characterModuleAttach.detachModuleFromCharacter;
const refreshAttachedModule = characterModuleAttach.refreshAttachedModule;
const detachModuleFromAllCharacters = characterModuleAttach.detachModuleFromAllCharacters;
const invalidateActiveForCharacter = characterModuleAttach.invalidateActiveForCharacter;
const charactersAttachedTo = characterModuleAttach.charactersAttachedTo;
const archiveModuleWorldBookBeforeMigration = worldBookOps.archiveModuleWorldBookBeforeMigration;
const syncModuleWorldBook = worldBookOps.syncModuleWorldBook;
void worldBookOps.addWorldBookToCharacter;
void worldBookOps.removeWorldBookFromCharacter;
const dispatchModuleArtifactInstall = worldBookOps.dispatchModuleArtifactInstall;

const lorebookImporter = createLorebookImporter({
  readLumirealm: (characterId, userId) => readLumirealm(charactersApi(), characterId, userId),
  createWorldBook: (input, userId) => spindle.world_books.create(input, userId),
  updateCharacterWorldBookIds: async (characterId, ids, userId) => {
    expectCharacterEdit(characterId);
    await spindle.characters.update(
      characterId,
      { world_book_ids: ids } as never,
      userId,
    );
  },
  createWorldBookEntry: (bookId, input, userId) =>
    spindle.world_books.entries.create(bookId, input as never, userId),
  send,
  log,
  errMsg,
  parseDirectLorebook,
  mapLoreBook,
});

const regexImporter = createRegexImporter({
  send,
  log,
  errMsg,
  parseDirectRegex,
  mapRegex,
});




const migrationsRunner = createMigrationsRunner({
  extensionVersion: EXTENSION_VERSION,
  currentModuleSchemaVersion: CURRENT_MODULE_SCHEMA_VERSION,
  translatorMigrationChecked,
  send,
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  writeModuleEnvelope: async (userId, env) => { await writeModuleEnvelope(moduleStorage(), userId, env); },
  dispatchModuleArtifactInstall: (charId, env, userId) => dispatchModuleArtifactInstall(charId, env, userId),
  writeLumirealm: (charId, data, userId) => writeLumirealm(charactersApi(), charId, data, userId),
  invalidateActiveForCharacter,
  toastFor,
  archiveModuleWorldBookBeforeMigration: (env, userId) => archiveModuleWorldBookBeforeMigration(env, userId),
  syncModuleWorldBook: (env, userId) => syncModuleWorldBook(env, userId),
  charactersAttachedTo: (moduleId, userId) => charactersAttachedTo(moduleId, userId),
  refreshAttachedModule: (charId, env, userId) => refreshAttachedModule(charId, env, userId),
  // Forward-bound: massMigrations supplies the actual archive notifier below, this trampoline calls into it once wired.
  notifyLorebookMigrationArchive: (label, wbId, uid) => massMigrations.notifyLorebookMigrationArchive(label, wbId, uid),
  log,
  errMsg,
});
const runCharacterMigration = migrationsRunner.runCharacterMigration;
const runModuleMigration = migrationsRunner.runModuleMigration;

const massMigrations = createMassMigrationsRunner({
  currentCharacterSchemaVersion: CURRENT_CHARACTER_SCHEMA_VERSION,
  currentModuleSchemaVersion: CURRENT_MODULE_SCHEMA_VERSION,
  translatorMigrationChecked,
  getMissingPermissions,
  moduleStorage,
  listModules: (userId) => listModuleStore(moduleStorage(), userId),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  listLumirealmCharacters: async (userId) => {
    const all = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return all.map((e) => ({
      character: { id: e.character.id, name: e.character.name ?? null },
      data: e.data,
    }));
  },
  writeLumirealm: (userId, characterId, data) => writeLumirealm(charactersApi(), characterId, data, userId),
  runModuleMigration,
  runCharacterMigration,
  emitOperationProgress,
  queueModalConfirm,
  toastFor,
  log,
  errMsg,
});

// Re-attempt mass migration for every captured user the moment all required
// permissions are granted. Per-chat path retries naturally on next chat-open
// because the gate skips without marking translatorMigrationChecked.
subscribeToMissingChanges((missing) => {
  if (missing.length > 0) return;
  if (capturedUserIds.size === 0) return;
  log.info(`permissions.changed: re-running mass migrations for ${capturedUserIds.size} captured user(s)`);
  for (const userId of capturedUserIds) {
    void (async () => {
      try {
        await massMigrations.runMassModuleMigrationIfNeeded(userId);
      } catch (err) {
        log.warn(`permissions.changed: mass module migration retry failed userId=${userId}: ${errMsg(err)}`);
      }
      try {
        await massMigrations.runMassCharacterMigrationIfNeeded(userId);
      } catch (err) {
        log.warn(`permissions.changed: mass character migration retry failed userId=${userId}: ${errMsg(err)}`);
      }
      try {
        await massMigrations.runRetiredMacroMigrationIfNeeded(userId);
      } catch (err) {
        log.warn(`permissions.changed: retired macro migration retry failed userId=${userId}: ${errMsg(err)}`);
      }
      try {
        await massMigrations.runVarScopeMigrationIfNeeded(userId);
      } catch (err) {
        log.warn(`permissions.changed: var-scope migration retry failed userId=${userId}: ${errMsg(err)}`);
      }
    })();
  }
});

const repairOrchestrator = createRepairOrchestrator({
  listLumirealmCharacters: async (userId) => {
    const entries = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    return entries.map((e) => ({
      character: { id: e.character.id, name: e.character.name ?? undefined },
      data: e.data,
    }));
  },
  writeLumirealm: (characterId, data, userId) => writeLumirealm(charactersApi(), characterId, data, userId),
  readLumirealm: (characterId, userId) => readLumirealm(charactersApi(), characterId, userId),
  updateLumirealm: (characterId, userId, fn) => updateLumirealm(charactersApi(), characterId, userId, fn),
  mergeUserOverrides: (base, patch) => mergeUserOverrides(base, patch as never),
  buildDetachModulesPatch: (base, ids) => buildDetachModulesPatch(base, ids) as never,
  runCharacterMigration: (charId, charName, userId, env, opts) =>
    runCharacterMigration(charId, charName, userId, env, opts),
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  refreshAttachedModule: (charId, env, userId) => refreshAttachedModule(charId, env, userId),
  translatorMigrationChecked,
  listStaleCharRegexIds,
  deleteRegexIds,
  sweepOrphanModuleRegex,
  clearDeadJournals,
  send,
  emitOperationProgress,
  log,
  errMsg,
});
void repairOrchestrator.forceRetranslateAll;
void repairOrchestrator.scrubDanglingModuleRefs;
const applyRepair = repairOrchestrator.applyRepair;




const viewerPushDeps: ViewerPushDeps = {
  assembleCharacter: (characterId, userId) => viewerAssembly.assembleCharacter(characterId, userId),
  assembleModule: (moduleId, userId) => viewerAssembly.assembleModule(moduleId, userId),
  send,
  warn: (m) => log.warn(m),
  errMsg,
};




const realmHandle: RealmBackendHandle = setupRealmBackend({
  send: (msg: RealmBackendToFrontend, userId: string | undefined) => send(msg, userId),
  log: {
    info: (m: string) => log.info(m),
    warn: (m: string) => log.warn(m),
    error: (m: string) => log.error(m),
  },
  importCardFromBytes: (bytes: Uint8Array, fileName: string, userId: string) =>
    importCardFromBytes(bytes, fileName, userId),
});

const HIGH_VOLUME_FRONTEND_MSG_TYPES: ReadonlySet<string> = new Set<string>();

const screenHandlers = createScreenHandlers({ setScreenDims, log });
const consentHandlers = createConsentHandlers({
  pendingConsents,
  resolveAlertDismissal,
  resolvePickResolution,
  log,
});
const connectionsHandlers = createConnectionsHandlers({ listConnectionsForUser, log });
const logHandlers = createLogHandlers({
  extensionVersion: EXTENSION_VERSION,
  logStore,
  isLogThreshold,
  ensureLogStateLoaded,
  persistLogState,
  userStorage,
  lastActiveChatByUser,
});
const settingsHandlers = createSettingsHandlers({
  getSettingsForUser,
  applySettingsPatch,
  normalizeSettingsPatch,
});
const translationsHandlers = createTranslationsHandlers({
  persistModuleTranslation,
  persistCharacterTranslation,
});
const variablesHandlers = createVariablesHandlers({
  writeLocalVariable,
  ensureActiveCardForChat,
  refreshVariables,
});
const togglesHandlers = createTogglesHandlers({
  writeToggleValue,
  ensureActiveCardForChat,
  refreshToggleDefinitions,
  log,
});
const dispatchHandlers = createDispatchHandlers({
  dispatchManualTrigger,
  dispatchButtonClick,
  log,
});
const lorebookHandlers = createLorebookHandlers({ lorebookImporter });
const regexHandlers = createRegexHandlers({ regexImporter });

// tus-uploaded bytes are redeemed by id (spindle.uploads, Lumi 1.1+).
const getUpload = (uploadId: string, uid: string): Promise<{ fileName: string; size: number; data: Uint8Array } | null> => {
  if (!spindle.uploads?.get) throw new Error('spindle.uploads unavailable; host update required');
  return spindle.uploads.get(uploadId, uid);
};
const deleteUpload = (uploadId: string, uid: string): Promise<boolean> => {
  if (!spindle.uploads?.delete) return Promise.resolve(false);
  return spindle.uploads.delete(uploadId, uid);
};

const importTextHandlers = createImportTextHandlers({
  lorebookImporter,
  regexImporter,
  getUpload,
  deleteUpload,
});
const assetsHandlers = createAssetsHandlers({
  blockedByRepair,
  mutateAssetIndex,
  viewerPushDeps,
  charactersAttachedTo,
  invalidateActiveForCharacter,
  refreshRisuAssetMap,
  log,
  errMsg,
});
const viewerHandlers = createViewerHandlers({
  blockedByRepair,
  charactersApi,
  updateLumirealm,
  mutateTriggerLua,
  viewerAssembly,
  viewerPushDeps,
  charactersAttachedTo,
  invalidateActiveForCharacter,
  readModuleEnvelope: (userId, moduleId) => readModuleEnvelope(moduleStorage(), userId, moduleId),
  writeModuleEnvelope: async (userId, env) => { await writeModuleEnvelope(moduleStorage(), userId, env); },
  send,
  log,
  errMsg,
});
const importHandlers = createImportHandlers({
  pendingImportCompletions,
  lastSentBgHtmlByChat,
  activeCardByChat,
  lastActiveChatByUser,
  hostVersionCheckRef: { get current() { return hostVersionCheck; } } as { current: HostVersionCheckResult | null },
  getMissingPermissions,
  permissionPurpose: PERMISSION_PURPOSE,
  listCards: async (uid) => listCards(uid),
  pushCards,
  ensureActiveCardForChat,
  sendSetActiveChat,
  invalidateRenderMcpForChat,
  invalidateMacroInterceptorForChat,
  refreshBgHtml,
  refreshVariables,
  importAnyFormat: (bytes, name, uid) => realmHandle.importAnyFormat(bytes, name, uid),
  getUpload,
  deleteUpload,
  applySvgRasterIndex,
  maybeFinalizeImport,
  characterGet: async (cid, uid) => {
    try {
      const c = await spindle.characters.get(cid, uid);
      return c ? { ...(c.name ? { name: c.name } : {}) } : null;
    } catch { return null; }
  },
  deleteCardByChar: (cid, uid, mode) => deleteCardByChar(cid, uid, mode),
  emitOperationProgress,
  notifyHostVersionOutdated: (msg, uid) => spindle.sendToFrontend(msg as never, uid),
  notifyMissingPermissions: (msg, uid) => spindle.sendToFrontend(msg as never, uid),
  log,
  errMsg,
});
const orphanHandlers = createOrphanHandlers({
  assetUploadsInFlightRef: { get current() { return assetUploadsInFlight; } } as { current: number },
  scanOrphanedImages,
  buildOrphanDetectDeps,
  deleteImageIds,
  emitOperationProgress,
  log,
  errMsg,
});
const repairHandlers = createRepairHandlers({
  assetUploadsInFlightRef: { get current() { return assetUploadsInFlight; } } as { current: number },
  repairInFlightByUser,
  scanRepairTargets,
  applyRepair,
  log,
  errMsg,
});
const moduleHandlers = createModuleHandlers({
  worldBookIdsByCharacter,
  setGlobalModules: async (moduleIds, userId) => {
    const { applied, added, removed } = await writeGlobalModuleIds(moduleStorage(), userId, moduleIds);
    setGlobalModuleIdsCache(userId, applied);

    // Teardown first: if a module is removed and re-added in one edit, the
    // stale rows must go before the new ones are recorded against it.
    for (const moduleId of removed) {
      const artifacts = await readGlobalModuleArtifacts(moduleStorage(), userId, moduleId);
      await worldBookOps.dispatchGlobalModuleArtifactUninstall(moduleId, artifacts, userId);
      await writeGlobalModuleArtifacts(moduleStorage(), userId, moduleId, {
        regexScriptIds: [],
        worldBookId: null,
      });
    }
    for (const moduleId of added) {
      const env = await readModuleEnvelope(moduleStorage(), userId, moduleId);
      if (!env) {
        log.warn(`set_global_modules: module ${moduleId} has no envelope, artifacts not installed`);
        continue;
      }
      const { worldBookId } = await worldBookOps.dispatchGlobalModuleArtifactInstall(env, userId);
      // Regex ids arrive later on module_artifacts_installed; the world book is
      // known now and must be recorded even when the module ships no regex.
      await writeGlobalModuleArtifacts(moduleStorage(), userId, moduleId, { worldBookId });
    }

    // Runtime cards were built with the old list, so every one is stale. Reuses
    // the per-character eviction rather than adding a second invalidation path.
    const chars = await listLumirealmCharacters(charactersApi(), userId, { paginate: true });
    for (const c of chars) invalidateActiveForCharacter(c.character.id, userId);
    log.info(
      `set_global_modules: user=${userId} count=${applied.length} ` +
        `added=${added.length} removed=${removed.length} invalidated=${chars.length}`,
    );
  },
  recordGlobalModuleArtifacts: async (moduleId, artifacts, userId) => {
    await writeGlobalModuleArtifacts(moduleStorage(), userId, moduleId, artifacts);
  },
  processModuleUpload,
  getUpload,
  deleteUpload,
  nudgeGc,
  readModuleEnvelope: (uid, moduleId) => readModuleEnvelope(moduleStorage(), uid, moduleId),
  readModuleImageJournalImageIds: async (uid, moduleId) => {
    const file = await readModuleImageJournalFile(journalStorage(), uid, moduleId);
    return file?.imageIds ?? [];
  },
  clearModuleImageJournal: (uid, moduleId) => clearModuleImageJournal(journalStorage(), uid, moduleId),
  deleteModuleFromStore: async (uid, moduleId) => {
    // Global artifacts are keyed off the module, not any character, so the
    // per-character detach sweep never sees them. Tear them down here or the
    // global regex rows and world-book entry outlive the module.
    const artifacts = await readGlobalModuleArtifacts(moduleStorage(), uid, moduleId);
    if (artifacts.regexScriptIds.length > 0 || artifacts.worldBookId) {
      await worldBookOps.dispatchGlobalModuleArtifactUninstall(moduleId, artifacts, uid);
      await writeGlobalModuleArtifacts(moduleStorage(), uid, moduleId, {
        regexScriptIds: [],
        worldBookId: null,
      });
    }
    await deleteModuleFromStore(moduleStorage(), uid, moduleId);
  },
  deleteSharedWorldBook: (wbId, uid) => spindle.world_books.delete(wbId, uid).then(() => undefined),
  buildOrphanDetectDeps,
  deleteImageIds,
  detachModuleFromAllCharacters,
  attachModuleToCharacter,
  detachModuleFromCharacter,
  charactersAttachedTo,
  refreshAttachedModule,
  pushModules,
  pushAttachedForCharacter,
  charactersApi,
  updateLumirealm,
  mergeUserOverrides,
  invalidateActiveForCharacter,
  emitOperationProgress,
  blockedByRepair,
  log,
  errMsg,
});

const exportHandlers = createExportHandlers({
  readModuleEnvelope: (uid, moduleId) => readModuleEnvelope(moduleStorage(), uid, moduleId),
  extensionVersion: EXTENSION_VERSION,
  log,
  errMsg,
});

// Typed exhaustive registry: any new FrontendToBackend variant without a
// handler entry here trips a compile-time error.
const handlerRegistry: HandlerRegistry = {
  ...importHandlers,
  ...consentHandlers,
  ...dispatchHandlers,
  ...variablesHandlers,
  ...settingsHandlers,
  ...translationsHandlers,
  ...connectionsHandlers,
  ...togglesHandlers,
  ...moduleHandlers,
  ...exportHandlers,
  ...assetsHandlers,
  ...viewerHandlers,
  ...lorebookHandlers,
  ...regexHandlers,
  ...importTextHandlers,
  ...screenHandlers,
  ...logHandlers,
  ...orphanHandlers,
  ...repairHandlers,
  ...createDisplayWritebackHandlers(),
  display_authority: async (msg) => {
    if (msg.authoritative) feDisplayShadowOptOut.delete(msg.chatId);
    else feDisplayShadowOptOut.add(msg.chatId);
  },
};

spindle.onFrontendMessage(userScoped(async (raw, userId) => {
  captureUserId(userId, 'frontend-message');
  const msg = raw as FrontendToBackend;
  if (!HIGH_VOLUME_FRONTEND_MSG_TYPES.has(msg.type)) {
    log.trace(`frontend msg type=${msg.type} userId=${userId ?? '<none>'}`);
  }
  // Operator-scoped extension contract: every FE WS arrives with a real userId
  // from BetterAuth. An undefined userId means the message bypassed auth and
  // any reply we send would broadcast to all connected users.
  if (!userId) {
    log.warn(`frontend msg type=${msg.type} dropped: no userId`);
    return;
  }
  const ctx: HandlerCallCtx = { userId, send, log, errMsg };
  try {
    if (isRealmFrontendMessage(msg)) {
      await realmHandle.handle(msg, userId);
      return;
    }
    const handler = handlerRegistry[msg.type] as Handler<typeof msg.type>;
    await handler(msg as never, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Frontend message handler error (type=${(msg as { type?: string }).type ?? '?'}): ${message}`);
    send({ type: 'error', message }, userId);
  }
}));

