import { hostCall } from '../host-services/client.js';
import * as tus from 'tus-js-client';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend, CardSummary, ImportProgress } from '../types/messages.js';
import { errMsg } from '../util/coerce.js';
import { isLogTransportNoise } from '../log/transport.js';
import { recoverModuleRegexScriptIds } from '../state/module-artifact-project.js';
import {
  planCardRegexCleanup,
  planModuleRegexCleanup,
  type RegexCleanupRow,
} from '../state/regex-cleanup.js';
import { pickNativeFile } from './native-file-picker.js';

// Mounts into a host element provided by ui/sidebar.ts.

const ACCEPT_EXTENSIONS = ['.charx', '.png', '.json', '.jpg', '.jpeg', '.risup', '.risupreset', '.risum'];

const UPLOAD_ENDPOINT = '/api/v1/spindle-uploads';
const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
// Server processing (translate + world-book creation) can take many seconds.
const PROCESSING_TIMEOUT_MS = 60_000;
const EXTENSION_IDENTIFIER = 'lumirealm';

interface DrawerState {
  /** Latest cards list pushed by backend. `null` = not yet received (pre-handshake). */
  cards: readonly CardSummary[] | null;
  /** Latest import_progress phase/message. `null` = idle. */
  progress: ImportProgress | null;
  /** Extra warnings / errors from the async upload path, cleared on new import. */
  notices: string[];
  /** True between "pick file" click and first backend response; recovery arrives as progress push. */
  optimistic: boolean;
}

export interface DrawerHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export interface FrontendLog {
  error(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  debug(msg: string, ...rest: unknown[]): void;
  trace(msg: string, ...rest: unknown[]): void;
}

export interface MountCardsPanelOptions {
  readonly root: HTMLElement;
  readonly ctx: SpindleFrontendContext;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
  readonly onImportStart?: (fileName: string, onCancel?: () => void, totalBytes?: number) => void;
  readonly onUploadProgress?: (sent: number, total: number) => void;
}

export function mountCardsPanel(opts: MountCardsPanelOptions): DrawerHandle {
  const { sendToBackend, log } = opts;
  log.info('cards-panel: mounting');

  const root = opts.root;

  const actionRow = document.createElement('div');
  actionRow.className = 'lrm-toolbar';
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'lrm-btn lrm-btn-primary';
  importBtn.textContent = 'Upload file…';
  importBtn.title = 'Pick a character card (.charx, .png, .json) or preset (.risup, .risupreset) file.';
  actionRow.appendChild(importBtn);
  root.appendChild(actionRow);

  const state: DrawerState = {
    cards: null,
    progress: null,
    notices: [],
    optimistic: false,
  };
  let activeTus: tus.Upload | null = null;
  let noProgressTimer: ReturnType<typeof setTimeout> | undefined;

  function render(): void { /* no-op */ }

  async function onImportClicked(): Promise<void> {
    if (importBtn.disabled) return;
    log.info('drawer: Import button clicked — opening file picker');
    let file: File | null = null;
    try {
      file = await pickNativeFile(ACCEPT_EXTENSIONS);
      if (!file) {
        log.info('drawer: picker dismissed without selection');
        return;
      }
      log.info(`drawer: picked file=${file.name} size=${file.size} mime=${file.type}`);
    } catch (err) {
      log.error('drawer: pickFile threw', err);
      state.notices = [`File picker failed: ${errMsg(err)}`];
      render();
      return;
    }

    state.optimistic = true;
    state.notices = [];
    importBtn.disabled = true;
    render();

    const fileName = file.name;
    const totalBytes = file.size;
    log.info(`drawer: upload file=${fileName} bytes=${totalBytes}`);

    let cancelled = false;
    opts.onImportStart?.(fileName, () => {
      cancelled = true;
      if (activeTus) { void activeTus.abort(true).catch(() => {}); activeTus = null; }
      clearNoProgress();
      log.info('drawer: upload cancel requested');
    }, totalBytes);

    state.progress = { phase: 'decoding', message: 'Starting upload…', fraction: 0 };
    render();

    const upload = new tus.Upload(file, {
      endpoint: UPLOAD_ENDPOINT,
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: fileName, extension: EXTENSION_IDENTIFIER },
      onError: (err) => {
        activeTus = null;
        if (cancelled) return;
        log.error('drawer: tus upload failed', err);
        state.optimistic = false;
        state.progress = { phase: 'error', message: `Upload failed: ${errMsg(err)}`, fraction: null };
        state.notices = [errMsg(err)];
        importBtn.disabled = false;
        render();
      },
      onProgress: (sent, total) => {
        const frac = total > 0 ? sent / total : null;
        state.progress = {
          phase: 'decoding',
          message: `Uploading (${frac != null ? Math.round(frac * 100) : 0}%)…`,
          fraction: frac,
        };
        opts.onUploadProgress?.(sent, total);
        render();
      },
      onSuccess: () => {
        activeTus = null;
        const uploadId = (upload.url ?? '').split('/').filter(Boolean).pop() ?? '';
        if (!uploadId) {
          state.optimistic = false;
          state.progress = { phase: 'error', message: 'Upload finished but no id was returned', fraction: null };
          importBtn.disabled = false;
          render();
          return;
        }
        log.info(`drawer: upload complete uploadId=${uploadId} — requesting import`);
        state.progress = { phase: 'translating', message: 'Processing on server…', fraction: null };
        render();
        sendToBackend({ type: 'import_card_from_upload', uploadId, fileName });
        armProcessingTimeout(PROCESSING_TIMEOUT_MS);
      },
    });
    activeTus = upload;

    try {
      const prev = await upload.findPreviousUploads();
      if (cancelled) return;
      if (prev[0]) upload.resumeFromPreviousUpload(prev[0]);
    } catch { /* no resumable state, start fresh */ }
    if (!cancelled) upload.start();
  }

  function clearNoProgress(): void {
    if (noProgressTimer) {
      clearTimeout(noProgressTimer);
      noProgressTimer = undefined;
    }
  }

  function armProcessingTimeout(timeoutMs: number): void {
    clearNoProgress();
    noProgressTimer = setTimeout(() => {
      noProgressTimer = undefined;
      log.error(`drawer: no import_progress within ${timeoutMs}ms after upload — failing`);
      state.optimistic = false;
      state.progress = {
        phase: 'error',
        message: `Server didn't respond within ${Math.round(timeoutMs / 1000)}s after upload. The backend may have crashed.`,
        fraction: null,
      };
      importBtn.disabled = false;
      render();
    }, timeoutMs);
  }

  importBtn.addEventListener('click', () => { void onImportClicked(); });

  async function listAllRegexRows(query: string): Promise<RegexCleanupRow[]> {
    const params = new URLSearchParams(query);
    const characterId = params.get('character_id');
    const rows: RegexCleanupRow[] = [];
    let total = 0;
    do {
      const page = await hostCall('regex.list', {
        scope: characterId ? 'character' : 'global',
        ...(characterId ? { scopeId: characterId } : {}),
        limit: 200, offset: rows.length,
      });
      rows.push(...page.data);
      total = page.total;
      if (page.data.length === 0) break;
    } while (rows.length < total);
    return rows;
  }

  async function deleteRegexRows(ids: readonly string[]): Promise<void> {
    const count = await hostCall('regex.delete', { ids: [...ids] });
    if (count !== ids.length) throw new Error(`Regex deletion count ${count}/${ids.length}`);
  }

  // Verify replacement ownership before deleting superseded rows.
  async function onInstallRegexScripts(
    msg: Extract<BackendToFrontend, { type: 'install_regex_scripts' }>,
  ): Promise<void> {
    log.info(`drawer: install_regex_scripts characterId=${msg.characterId} name=${msg.characterName} count=${msg.scripts.length}`);
    // Empty arrays are intentional: a verified empty replacement set removes
    // stale card rows after the ownership phase succeeds.
    const sampleDisplay = msg.scripts.find((s) => s.target === 'display');
    if (sampleDisplay) {
      log.info(
        `drawer: first display rule name=${sampleDisplay.name} ` +
          `scope=${sampleDisplay.scope} scope_id=${sampleDisplay.scope_id} ` +
          `sub_macros=${sampleDisplay.substitute_macros} find=${JSON.stringify(sampleDisplay.find_regex).slice(0, 100)} ` +
          `replace[0..400]=${JSON.stringify(sampleDisplay.replace_string).slice(0, 400)}`,
      );
    }
    let replacementVerified = false;
    let cleanupCompleted = !msg.cleanupStale;
    try {
      const rows = await listAllRegexRows(
        `scope=character&character_id=${encodeURIComponent(msg.characterId)}`,
      );
      const plan = planCardRegexCleanup(rows, msg.characterId, msg.scripts);
      if (!plan.verified) throw new Error('replacement rows could not be verified');
      replacementVerified = true;
      if (msg.cleanupStale) {
        if (plan.staleIds.length > 0) {
          await deleteRegexRows(plan.staleIds);
          log.info(`drawer: removed ${plan.staleIds.length} verified stale card regex row(s) char=${msg.characterId}`);
        }
        cleanupCompleted = true;
      }
    } catch (err) {
      log.warn(`drawer: post-install verification or stale cleanup failed; existing rows were kept`, err);
    }
    if (msg.requestId) {
      sendToBackend({
        type: 'regex_scripts_installed',
        requestId: msg.requestId,
        ok: replacementVerified,
        cleanupCompleted,
      });
    }
  }

  async function cleanupCharacterArtifacts(characterId: string, worldBookIds: readonly string[]): Promise<void> {
    try {
      const rows = await listAllRegexRows(`scope=character&character_id=${encodeURIComponent(characterId)}`);
      const ids = rows.filter(row => row.scope === 'character' && row.scope_id === characterId).map(row => row.id);
      if (ids.length) await deleteRegexRows(ids);
    } catch (error) { log.warn('Character regex cleanup failed', error); }
    for (const id of worldBookIds) {
      try { await hostCall('worldbook.delete', { id }); }
      catch (error) { log.warn(`World book cleanup failed id=${id}`, error); }
    }
  }

  // Replies with resource ids retained for detach.
  async function installModuleArtifacts(
    msg: Extract<BackendToFrontend, { type: 'install_module_artifacts' }>,
  ): Promise<void> {
    log.info(
      `drawer.installModuleArtifacts: char=${msg.characterId} module=${msg.moduleId} ` +
        `lorebookEntries=${msg.lorebookEntries.length} regexScripts=${msg.regexScripts.length}`,
    );
    let worldBookId: string | null = null;
    const regexScriptIds: string[] = [];

    let regexInstallOk = msg.cleanupStale;
    let cleanupCompleted = !msg.cleanupStale;
    let liveRows: RegexCleanupRow[] = [];
    if (regexInstallOk) {
      try {
        const listQuery = msg.characterId === null
          ? 'scope=global'
          : `scope=character&character_id=${encodeURIComponent(msg.characterId)}`;
        liveRows = await listAllRegexRows(listQuery);

        if (msg.cleanupStale) {
          const plan = planModuleRegexCleanup(liveRows, msg.moduleId, msg.regexScripts);
          if (!plan.verified) throw new Error('replacement rows could not be verified');
          if (plan.staleIds.length > 0) {
            await deleteRegexRows(plan.staleIds);
            const stale = new Set(plan.staleIds);
            liveRows = liveRows.filter((row) => !stale.has(row.id));
          }
          cleanupCompleted = true;
        }

        const recovered = recoverModuleRegexScriptIds(
          msg.moduleId,
          msg.regexScripts,
          liveRows,
        );
        regexScriptIds.push(...recovered.ids);
        if (!recovered.exact) {
          regexInstallOk = false;
          log.warn(
            `drawer.installModuleArtifacts: could not verify one live row per source rule ` +
              `for module=${msg.moduleId}; previous tracking is preserved`,
          );
        }
      } catch (err) {
        regexInstallOk = false;
        log.warn(`drawer.installModuleArtifacts: verification/cleanup failed; existing rows were kept`, err);
      }
    }

    sendToBackend({
      type: 'module_artifacts_installed',
      ...(msg.requestId ? { requestId: msg.requestId } : {}),
      characterId: msg.characterId,
      moduleId: msg.moduleId,
      worldBookId,
      regexScriptIds,
      ok: regexInstallOk,
      cleanupCompleted,
    });
  }

  async function uninstallModuleArtifacts(
    msg: Extract<BackendToFrontend, { type: 'uninstall_module_artifacts' }>,
  ): Promise<void> {
    log.info(
      `drawer.uninstallModuleArtifacts: char=${msg.characterId} module=${msg.moduleId} ` +
        `worldBookId=${msg.worldBookId ?? 'null'} regex=${msg.regexScriptIds.length}`,
    );
    let ok = true;
    if (msg.worldBookId && msg.characterId !== null) {
      try {
        const character = await hostCall('character.get', { id: msg.characterId });
        if (character?.world_book_ids?.includes(msg.worldBookId)) {
          await hostCall('character.linkBooks', { id: msg.characterId,
            worldBookIds: character.world_book_ids.filter(id => id !== msg.worldBookId) });
        }
        await hostCall('worldbook.delete', { id: msg.worldBookId });
      } catch (error) { ok = false; log.warn('Module world book removal failed', error); }
    }
    try {
      const query = msg.characterId === null ? 'scope=global' : `scope=character&character_id=${encodeURIComponent(msg.characterId)}`;
      const rows = await listAllRegexRows(query);
      const ids = new Set(msg.regexScriptIds);
      for (const row of rows) {
        const metadata = row.metadata?._risu as { module_id?: string } | undefined;
        if (row.scope === (msg.characterId === null ? 'global' : 'character')
            && (msg.characterId === null || row.scope_id === msg.characterId)
            && metadata?.module_id === msg.moduleId) ids.add(row.id);
      }
      if (ids.size) await deleteRegexRows([...ids]);
    } catch (error) { ok = false; log.warn('Module regex removal failed', error); }

    sendToBackend({
      type: 'module_artifacts_uninstalled',
      characterId: msg.characterId,
      moduleId: msg.moduleId,
      ok,
    });
  }

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (!isLogTransportNoise(msg.type)) log.info(`drawer.handle: ${msg.type}`);
    switch (msg.type) {
      case 'cards_updated':
        log.info(`drawer.cards_updated: count=${msg.cards.length}`);
        state.cards = msg.cards;
        render();
        break;
      case 'cleanup_character_artifacts':
        void cleanupCharacterArtifacts(msg.characterId, msg.worldBookIds);
        break;
      case 'install_module_artifacts':
        void installModuleArtifacts(msg);
        break;
      case 'uninstall_module_artifacts':
        void uninstallModuleArtifacts(msg);
        break;
      case 'import_progress':
        log.info(`drawer.import_progress: phase=${msg.phase} frac=${msg.fraction ?? '?'}`);
        clearNoProgress();
        state.progress = {
          phase: msg.phase,
          message: msg.message,
          fraction: msg.fraction ?? null,
        };
        state.optimistic = false;
        if (msg.phase === 'done') {
          importBtn.disabled = false;
        } else if (msg.phase === 'error') {
          importBtn.disabled = false;
          if (msg.error) state.notices = [msg.error];
          log.warn(`drawer: import error surfaced: ${msg.error ?? '(no detail)'}`);
        }
        render();
        break;
      case 'install_regex_scripts':
        void onInstallRegexScripts(msg);
        break;
      case 'notify_legacy_card_needs_reimport':
        // Handled by setupLegacyReimportModal.
        break;
      case 'error':
        log.error(`drawer.error: ${msg.message}`);
        clearNoProgress();
        state.progress = {
          phase: 'error',
          message: msg.message,
          fraction: null,
        };
        state.optimistic = false;
        importBtn.disabled = false;
        render();
        break;
    }
  }

  render();
  log.info('cards-panel: ready');

  return {
    handleBackendMessage,
    destroy(): void {
      log.info('cards-panel: destroy');
      try { root.replaceChildren(); } catch { /* ignore */ }
    },
  };
}

