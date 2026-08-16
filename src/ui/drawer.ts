import * as tus from 'tus-js-client';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend, CardSummary, ImportProgress } from '../types/messages.js';
import { errMsg } from '../util/coerce.js';
import { recoverModuleRegexScriptIds } from '../state/module-artifact-project.js';
import {
  planCardRegexCleanup,
  planModuleRegexCleanup,
  type RegexCleanupRow,
} from '../state/regex-cleanup.js';

// Mounts into a host element provided by ui/sidebar.ts.

const ACCEPT_EXTENSIONS = ['.charx', '.png', '.json', '.jpg', '.jpeg'];

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
  const { ctx, sendToBackend, log } = opts;
  log.info('cards-panel: mounting');

  const root = opts.root;

  const actionRow = document.createElement('div');
  actionRow.className = 'lrm-toolbar';
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'lrm-btn lrm-btn-primary';
  importBtn.textContent = 'Upload card';
  importBtn.title = 'Pick a .charx, .png, .json, or .jpg/.jpeg character file.';
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
    let file: { name: string; bytes: Uint8Array } | null = null;
    try {
      const [picked] = await ctx.uploads.pickFile({ accept: ACCEPT_EXTENSIONS });
      if (!picked) {
        log.info('drawer: picker dismissed without selection');
        return;
      }
      file = { name: picked.name, bytes: picked.bytes };
      log.info(`drawer: picked file=${picked.name} size=${picked.bytes.byteLength} mime=${picked.mimeType}`);
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
    const totalBytes = file.bytes.byteLength;
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

    const upload = new tus.Upload(new Blob([file.bytes as BlobPart]), {
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
    const rows: RegexCleanupRow[] = [];
    let total = 0;
    do {
      const resp = await fetch(
        `/api/v1/regex-scripts?${query}&limit=1000&offset=${rows.length}`,
        { credentials: 'include' },
      );
      if (!resp.ok) throw new Error(`list HTTP ${resp.status}`);
      const page = (await resp.json()) as { data?: RegexCleanupRow[]; total?: number };
      const data = page.data ?? [];
      rows.push(...data);
      total = page.total ?? rows.length;
      if (data.length === 0) break;
    } while (rows.length < total);
    return rows;
  }

  // Verify backend-installed rows, then clean legacy rows via cookie-auth REST.
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
          const delResp = await fetch('/api/v1/regex-scripts/bulk-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: plan.staleIds }),
            credentials: 'include',
          });
          if (!delResp.ok) throw new Error(`bulk-delete HTTP ${delResp.status}`);
          const deleted = (await delResp.json()) as { count?: number };
          if (deleted.count !== plan.staleIds.length) {
            throw new Error(`bulk-delete count ${deleted.count ?? 0}/${plan.staleIds.length}`);
          }
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

  async function cleanupCharacterArtifacts(
    characterId: string,
    worldBookIds: readonly string[],
  ): Promise<void> {
    log.info(
      `drawer.cleanup: characterId=${characterId} worldBookCount=${worldBookIds.length}`,
    );
    try {
      const listResp = await fetch(
        `/api/v1/regex-scripts?scope=character&character_id=${encodeURIComponent(characterId)}&limit=2000`,
        { credentials: 'include' },
      );
      if (listResp.ok) {
        const body = (await listResp.json()) as {
          data?: Array<{ id: string; scope?: string; scope_id?: string }>;
        };
        const ids = (body.data ?? [])
          .filter((r) => r.scope === 'character' && r.scope_id === characterId)
          .map((r) => r.id);
        if (ids.length > 0) {
          const delResp = await fetch('/api/v1/regex-scripts/bulk-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids }),
            credentials: 'include',
          });
          if (delResp.ok) {
            const delBody = (await delResp.json()) as { count?: number };
            log.info(
              `drawer.cleanup: regex deleted=${delBody?.count ?? '?'} (sent ${ids.length})`,
            );
          } else {
            log.warn(`drawer.cleanup: regex bulk-delete HTTP ${delResp.status}`);
          }
        } else {
          log.info(`drawer.cleanup: no character-scoped regex to remove for ${characterId}`);
        }
      } else {
        log.warn(`drawer.cleanup: regex list HTTP ${listResp.status}`);
      }
    } catch (err) {
      log.warn(`drawer.cleanup: regex cleanup threw`, err);
    }
    for (const wbId of worldBookIds) {
      try {
        const resp = await fetch(`/api/v1/world-books/${encodeURIComponent(wbId)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (resp.ok) {
          log.info(`drawer.cleanup: world_book deleted id=${wbId}`);
        } else if (resp.status === 404) {
          log.info(`drawer.cleanup: world_book ${wbId} already absent`);
        } else {
          log.warn(`drawer.cleanup: world_book delete HTTP ${resp.status} id=${wbId}`);
        }
      } catch (err) {
        log.warn(`drawer.cleanup: world_book delete threw id=${wbId}`, err);
      }
    }
  }

  // Cookie-auth module install; replies with resource ids for detach.
  async function installModuleArtifacts(
    msg: Extract<BackendToFrontend, { type: 'install_module_artifacts' }>,
  ): Promise<void> {
    log.info(
      `drawer.installModuleArtifacts: char=${msg.characterId} module=${msg.moduleId} ` +
        `lorebookEntries=${msg.lorebookEntries.length} regexScripts=${msg.regexScripts.length}`,
    );
    let worldBookId: string | null = null;
    const regexScriptIds: string[] = [];

    // Global installs carry no lorebook entries (the module's world book is
    // attached through world_books.setGlobal on the backend), so this block is
    // character-only and its character fetches stay safe.
    if (msg.lorebookEntries.length > 0 && msg.characterId !== null) {
      try {
        const createResp = await fetch('/api/v1/world-books', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: msg.worldBookName }),
          credentials: 'include',
        });
        if (createResp.ok) {
          const body = (await createResp.json()) as { id?: string };
          if (typeof body?.id === 'string') {
            worldBookId = body.id;
            const importResp = await fetch(
              `/api/v1/world-books/${encodeURIComponent(worldBookId)}/entries/import`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ entries: msg.lorebookEntries }),
                credentials: 'include',
              },
            );
            if (!importResp.ok) {
              log.warn(
                `drawer.installModuleArtifacts: world_book entries import HTTP ${importResp.status} ` +
                  `for module=${msg.moduleId} — book created but entries may be missing`,
              );
            }
            const charResp = await fetch(
              `/api/v1/characters/${encodeURIComponent(msg.characterId)}`,
              { credentials: 'include' },
            );
            if (charResp.ok) {
              const cur = (await charResp.json()) as { world_book_ids?: unknown };
              const existing = Array.isArray(cur.world_book_ids)
                ? cur.world_book_ids.filter((x): x is string => typeof x === 'string')
                : [];
              if (!existing.includes(worldBookId)) {
                const updResp = await fetch(
                  `/api/v1/characters/${encodeURIComponent(msg.characterId)}`,
                  {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      world_book_ids: [...existing, worldBookId],
                    }),
                    credentials: 'include',
                  },
                );
                if (!updResp.ok) {
                  log.warn(
                    `drawer.installModuleArtifacts: character world_book_ids update HTTP ${updResp.status} ` +
                      `for module=${msg.moduleId} — book exists but isn't attached`,
                  );
                }
              }
            }
          }
        } else {
          log.warn(
            `drawer.installModuleArtifacts: world_book create HTTP ${createResp.status} for module=${msg.moduleId}`,
          );
        }
      } catch (err) {
        log.warn(`drawer.installModuleArtifacts: world_book pipeline threw`, err);
      }
    }

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
            const delResp = await fetch('/api/v1/regex-scripts/bulk-delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ids: plan.staleIds }),
              credentials: 'include',
            });
            if (!delResp.ok) throw new Error(`bulk-delete HTTP ${delResp.status}`);
            const deleted = (await delResp.json()) as { count?: number };
            if (deleted.count !== plan.staleIds.length) {
              throw new Error(`bulk-delete count ${deleted.count ?? 0}/${plan.staleIds.length}`);
            }
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
    // Global scope has no character row to unlink from; the backend drops the
    // book from world_books.setGlobal before sending this.
    if (msg.worldBookId && msg.characterId !== null) {
      try {
        const charResp = await fetch(
          `/api/v1/characters/${encodeURIComponent(msg.characterId)}`,
          { credentials: 'include' },
        );
        if (charResp.ok) {
          const cur = (await charResp.json()) as { world_book_ids?: unknown };
          const existing = Array.isArray(cur.world_book_ids)
            ? cur.world_book_ids.filter((x): x is string => typeof x === 'string')
            : [];
          if (existing.includes(msg.worldBookId)) {
            await fetch(`/api/v1/characters/${encodeURIComponent(msg.characterId)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                world_book_ids: existing.filter((id) => id !== msg.worldBookId),
              }),
              credentials: 'include',
            });
          }
        }
        const delResp = await fetch(
          `/api/v1/world-books/${encodeURIComponent(msg.worldBookId)}`,
          { method: 'DELETE', credentials: 'include' },
        );
        if (!delResp.ok && delResp.status !== 404) {
          ok = false;
          log.warn(
            `drawer.uninstallModuleArtifacts: world_book delete HTTP ${delResp.status} id=${msg.worldBookId}`,
          );
        }
      } catch (err) {
        ok = false;
        log.warn(`drawer.uninstallModuleArtifacts: world_book pipeline threw`, err);
      }
    }
    // Metadata-keyed delete catches stale stashed IDs + orphans from prior
    // install/refresh races. Falls back to stashed IDs if listing fails.
    const idsToDelete = new Set<string>(msg.regexScriptIds);
    try {
      const uninstallQuery = msg.characterId === null
        ? 'scope=global'
        : `scope=character&character_id=${encodeURIComponent(msg.characterId)}`;
      const listResp = await fetch(
        `/api/v1/regex-scripts?${uninstallQuery}&limit=2000`,
        { credentials: 'include' },
      );
      if (listResp.ok) {
        const body = (await listResp.json()) as {
          data?: Array<{
            id: string;
            scope?: string;
            scope_id?: string;
            metadata?: { _risu?: { module_id?: string } };
          }>;
        };
        for (const r of body.data ?? []) {
          if (
            r.scope === 'character'
              && r.scope_id === msg.characterId
              && r.metadata?._risu?.module_id === msg.moduleId
          ) {
            idsToDelete.add(r.id);
          }
        }
      } else {
        log.warn(`drawer.uninstallModuleArtifacts: list HTTP ${listResp.status}, falling back to stashed IDs only`);
      }
    } catch (err) {
      log.warn(`drawer.uninstallModuleArtifacts: list threw, falling back to stashed IDs only`, err);
    }
    if (idsToDelete.size > 0) {
      try {
        const resp = await fetch('/api/v1/regex-scripts/bulk-delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [...idsToDelete] }),
          credentials: 'include',
        });
        if (!resp.ok) {
          ok = false;
          log.warn(
            `drawer.uninstallModuleArtifacts: regex bulk-delete HTTP ${resp.status} (sent ${idsToDelete.size})`,
          );
        } else {
          log.info(
            `drawer.uninstallModuleArtifacts: regex bulk-deleted ${idsToDelete.size} (stashed=${msg.regexScriptIds.length})`,
          );
        }
      } catch (err) {
        ok = false;
        log.warn(`drawer.uninstallModuleArtifacts: regex pipeline threw`, err);
      }
    }
    sendToBackend({
      type: 'module_artifacts_uninstalled',
      characterId: msg.characterId,
      moduleId: msg.moduleId,
      ok,
    });
  }

  function handleBackendMessage(msg: BackendToFrontend): void {
    log.info(`drawer.handle: ${msg.type}`);
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

