import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend, CardSummary, ImportProgress } from '../types/messages.js';
import { errMsg } from '../util/coerce.js';

// Mounts into a host element provided by ui/sidebar.ts.

const ACCEPT_EXTENSIONS = ['.charx', '.png', '.json', '.jpg', '.jpeg'];

// 2.5 MB raw base64s to ~3.34 MB, fits under Lumi's 4 MB SPINDLE_BACKEND_MSG
// ceiling with envelope room. 3 MB raw alone base64s to exactly 4 MB.
const CHUNK_BYTES = 2500 * 1024;
const CHUNK_WIRE_WARN_BYTES = 3_800_000;
// Commit timeout is long because translation + world-book creation can
// take many seconds on a large card.
const INIT_ACK_TIMEOUT_MS = 15_000;
const CHUNK_ACK_TIMEOUT_MS = 20_000;
const COMMIT_FIRST_PROGRESS_TIMEOUT_MS = 60_000;
const UPLOAD_WINDOW_SIZE = 30;

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

interface PendingAck {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface UploadSession {
  readonly sessionId: string;
  /** Most-recent ack seq (-1=init, -2=commit-received, else chunk seq). */
  lastAckSeq: number;
  receivedBytesOnBackend: number;
  pendingAcks: Map<number, PendingAck>;
  aborted: boolean;
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
  let activeUpload: UploadSession | null = null;

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

    const sessionId = generateSessionId();
    const totalBytes = file.bytes.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_BYTES));
    log.info(`drawer: upload session=${sessionId} file=${file.name} bytes=${totalBytes} chunks=${totalChunks} chunkSize=${CHUNK_BYTES}`);

    activeUpload = {
      sessionId,
      lastAckSeq: -999,
      receivedBytesOnBackend: 0,
      pendingAcks: new Map(),
      aborted: false,
    };
    const session = activeUpload;
    opts.onImportStart?.(file.name, () => {
      if (!session.aborted) {
        session.aborted = true;
        log.info(`drawer: cancel requested session=${sessionId}`);
        rejectAllPending(session, new Error('upload cancelled'));
      }
    }, totalBytes);

    try {
      state.progress = { phase: 'decoding', message: `Starting upload (0/${totalChunks})…`, fraction: 0 };
      render();
      const tInit = performance.now();
      sendToBackend({
        type: 'import_card_init',
        sessionId,
        fileName: file.name,
        totalBytes,
        totalChunks,
      });
      await trackAck(session, -1, INIT_ACK_TIMEOUT_MS, 'init');
      log.info(`drawer: init acked in ${Math.round(performance.now() - tInit)}ms`);

      const tAllChunks = performance.now();
      let completed = 0;
      let nextSeq = 0;
      const errors: Error[] = [];
      const sendOne = async (): Promise<void> => {
        while (true) {
          if (session.aborted || errors.length > 0) return;
          const seq = nextSeq++;
          if (seq >= totalChunks) return;
          const start = seq * CHUNK_BYTES;
          const end = Math.min(start + CHUNK_BYTES, totalBytes);
          const slice = file.bytes.subarray(start, end);
          const b64 = bytesToBase64(slice);
          const chunkMsg: FrontendToBackend = {
            type: 'import_card_chunk',
            sessionId,
            seq,
            bytesB64Chunk: b64,
          };
          const wireSize = JSON.stringify(chunkMsg).length;
          if (wireSize > CHUNK_WIRE_WARN_BYTES) {
            log.warn(
              `drawer: chunk wire size ${wireSize}B approaches Lumi's 64KB inbound guard ` +
                `(seq=${seq} of ${totalChunks}, raw_chunk=${slice.byteLength}B, b64=${b64.length}B). ` +
                `Reduce CHUNK_BYTES if this happens.`,
            );
          }
          const ack = trackAck(session, seq, CHUNK_ACK_TIMEOUT_MS, `chunk ${seq}`);
          sendToBackend(chunkMsg);
          try {
            await ack;
          } catch (err) {
            errors.push(err as Error);
            return;
          }
          completed += 1;
          state.progress = {
            phase: 'decoding',
            message: `Uploading (${completed}/${totalChunks})…`,
            fraction: completed / totalChunks,
          };
          render();
        }
      };
      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(UPLOAD_WINDOW_SIZE, totalChunks); w++) {
        workers.push(sendOne());
      }
      await Promise.all(workers);
      if (errors.length > 0) throw errors[0];
      if (session.aborted) throw new Error('upload aborted');
      log.info(`drawer: all ${totalChunks} chunks acked in ${Math.round(performance.now() - tAllChunks)}ms`);

      state.progress = { phase: 'translating', message: 'Processing on server…', fraction: null };
      render();
      const tCommit = performance.now();
      sendToBackend({ type: 'import_card_commit', sessionId });
      await trackAck(session, -2, CHUNK_ACK_TIMEOUT_MS, 'commit-ack');
      log.info(`drawer: commit acked in ${Math.round(performance.now() - tCommit)}ms — awaiting import_progress`);

      armNoProgressTimeout(session, COMMIT_FIRST_PROGRESS_TIMEOUT_MS);
    } catch (err) {
      log.error('drawer: upload failed', err);
      try { sendToBackend({ type: 'import_card_abort', sessionId, reason: errMsg(err) }); } catch { /* */ }
      rejectAllPending(session, err instanceof Error ? err : new Error(String(err)));
      if (activeUpload?.sessionId === sessionId) activeUpload = null;
      state.optimistic = false;
      state.progress = {
        phase: 'error',
        message: `Upload failed: ${errMsg(err)}`,
        fraction: null,
      };
      state.notices = [errMsg(err)];
      importBtn.disabled = false;
      render();
    }
  }

  function trackAck(
    session: UploadSession,
    seq: number,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    if (session.lastAckSeq === seq) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (session.pendingAcks.delete(seq)) {
          session.aborted = true;
          reject(new Error(`timeout waiting for ${label} ack after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      session.pendingAcks.set(seq, { resolve, reject, timer });
    });
  }

  function rejectAllPending(session: UploadSession, err: Error): void {
    for (const [seq, p] of session.pendingAcks) {
      clearTimeout(p.timer);
      p.reject(err);
      session.pendingAcks.delete(seq);
    }
  }

  let noProgressTimer: ReturnType<typeof setTimeout> | undefined;
  function clearAckTimer(_session: UploadSession): void {
    if (noProgressTimer) {
      clearTimeout(noProgressTimer);
      noProgressTimer = undefined;
    }
  }

  function armNoProgressTimeout(session: UploadSession, timeoutMs: number): void {
    clearAckTimer(session);
    noProgressTimer = setTimeout(() => {
      if (activeUpload !== session) return;
      log.error(`drawer: no import_progress within ${timeoutMs}ms after commit — failing`);
      session.aborted = true;
      activeUpload = null;
      state.progress = {
        phase: 'error',
        message: `Server didn't respond within ${Math.round(timeoutMs / 1000)}s after upload. The backend may have crashed.`,
        fraction: null,
      };
      importBtn.disabled = false;
      render();
    }, timeoutMs);
  }

  function onUploadAck(sessionId: string, seq: number, receivedBytes: number): void {
    const session = activeUpload;
    if (!session || session.sessionId !== sessionId) {
      log.warn(`drawer: stray upload ack session=${sessionId} seq=${seq} — ignoring`);
      return;
    }
    session.lastAckSeq = seq;
    session.receivedBytesOnBackend = receivedBytes;
    const p = session.pendingAcks.get(seq);
    if (p) {
      session.pendingAcks.delete(seq);
      clearTimeout(p.timer);
      p.resolve();
    }
  }

  importBtn.addEventListener('click', () => { void onImportClicked(); });

  // Regex-script install via cookie-auth REST (worker can't reach this route).
  async function onInstallRegexScripts(
    msg: Extract<BackendToFrontend, { type: 'install_regex_scripts' }>,
  ): Promise<void> {
    log.info(`drawer: install_regex_scripts characterId=${msg.characterId} name=${msg.characterName} count=${msg.scripts.length}`);
    // Empty array is intentional. Pre-clean still runs to evict stale
    // rules from older extension versions.
    const sampleDisplay = msg.scripts.find((s) => s.target === 'display');
    if (sampleDisplay) {
      log.info(
        `drawer: first display rule name=${sampleDisplay.name} ` +
          `scope=${sampleDisplay.scope} scope_id=${sampleDisplay.scope_id} ` +
          `sub_macros=${sampleDisplay.substitute_macros} find=${JSON.stringify(sampleDisplay.find_regex).slice(0, 100)} ` +
          `replace[0..400]=${JSON.stringify(sampleDisplay.replace_string).slice(0, 400)}`,
      );
    }
    const t0 = performance.now();

    // Pre-clean: Lumi has no FK cascade on character delete, so re-imports
    // stack duplicate rules unless we evict the old ones first. Skip module-
    // owned rows (those have their own attach/detach lifecycle).
    try {
      const existingResp = await fetch(
        `/api/v1/regex-scripts?scope=character&character_id=${encodeURIComponent(msg.characterId)}&limit=1000`,
        { credentials: 'include' },
      );
      if (existingResp.ok) {
        const body = (await existingResp.json()) as {
          data?: Array<{
            id: string;
            scope?: string;
            scope_id?: string;
            metadata?: { _risu?: { module_id?: string; imported_regex?: boolean } };
          }>;
        };
        const existingIds = (body.data ?? [])
          .filter((r) =>
            r.scope === 'character'
              && r.scope_id === msg.characterId
              && !r.metadata?._risu?.module_id
              // User-imported regex (Import → Regex) has its own lifecycle.
              && !r.metadata?._risu?.imported_regex,
          )
          .map((r) => r.id);
        if (existingIds.length > 0) {
          log.info(`drawer: pre-clean removing ${existingIds.length} existing character-scoped rule(s) for char=${msg.characterId}`);
          const delResp = await fetch('/api/v1/regex-scripts/bulk-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: existingIds }),
            credentials: 'include',
          });
          if (!delResp.ok) {
            log.warn(`drawer: pre-clean bulk-delete HTTP ${delResp.status} — proceeding with install anyway (will accumulate)`);
          } else {
            const delBody = (await delResp.json()) as { count?: number };
            log.info(`drawer: pre-clean deleted=${delBody?.count ?? '?'}`);
          }
        } else {
          log.info(`drawer: pre-clean no existing character-scoped rules for char=${msg.characterId}`);
        }
      } else {
        log.warn(`drawer: pre-clean list fetch HTTP ${existingResp.status} — proceeding without pre-clean`);
      }
    } catch (err) {
      log.warn(`drawer: pre-clean threw — proceeding with install`, err);
    }

    if (msg.scripts.length === 0) {
      log.info(`drawer: install_regex_scripts done (cleanup-only, nothing to install) for char=${msg.characterId}`);
      return;
    }

    try {
      const resp = await fetch('/api/v1/regex-scripts/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scripts: msg.scripts }),
        credentials: 'include',
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = ' — ' + (await resp.text()).slice(0, 200); } catch { /* */ }
        throw new Error(`HTTP ${resp.status}${detail}`);
      }
      const body = (await resp.json()) as {
        imported?: number; skipped?: number; errors?: string[];
      };
      const imported = body?.imported ?? 0;
      const skipped = body?.skipped ?? 0;
      const errors = Array.isArray(body?.errors) ? body.errors : [];
      log.info(
        `drawer: regex import response imported=${imported} skipped=${skipped} errors=${errors.length} ` +
          `httpStatus=${resp.status} elapsed=${Math.round(performance.now() - t0)}ms ` +
          `expected=${msg.scripts.length}`,
      );
      if (errors.length > 0) {
        for (const e of errors) log.warn(`drawer: regex error — ${e}`);
      }
      if (imported !== msg.scripts.length) {
        log.warn(
          `drawer: regex install count mismatch — sent ${msg.scripts.length}, Lumi accepted ${imported}. ` +
            `Display-target rules may be incomplete for this character.`,
        );
      }
      if (skipped > 0 || errors.length > 0) {
        const notices = [...state.notices];
        notices.push(
          `${skipped} regex rule(s) were skipped by Lumiverse (${imported} installed).`,
        );
        for (const e of errors.slice(0, 3)) notices.push(`  • ${e}`);
        if (errors.length > 3) notices.push(`  • …and ${errors.length - 3} more`);
        state.notices = notices;
        render();
      }
    } catch (err) {
      log.error(`drawer: regex import failed`, err);
      const notices = [...state.notices];
      notices.push(`Failed to install ${msg.scripts.length} regex rule(s): ${errMsg(err)}`);
      state.notices = notices;
      render();
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

    if (msg.lorebookEntries.length > 0) {
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

    if (msg.regexScripts.length > 0) {
      try {
        const resp = await fetch('/api/v1/regex-scripts/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scripts: msg.regexScripts }),
          credentials: 'include',
        });
        if (resp.ok) {
          const body = (await resp.json()) as {
            imported_ids?: unknown;
            imported?: number;
          };
          // imported_ids absent on older Lumi builds, fall back to listing
          // and filtering by metadata._risu.module_id.
          if (Array.isArray(body.imported_ids)) {
            for (const id of body.imported_ids) {
              if (typeof id === 'string') regexScriptIds.push(id);
            }
          } else {
            try {
              const listResp = await fetch(
                `/api/v1/regex-scripts?scope=character&character_id=${encodeURIComponent(msg.characterId)}&limit=2000`,
                { credentials: 'include' },
              );
              if (listResp.ok) {
                const listBody = (await listResp.json()) as {
                  data?: Array<{
                    id: string;
                    metadata?: { _risu?: { module_id?: string } };
                  }>;
                };
                for (const r of listBody.data ?? []) {
                  if (r.metadata?._risu?.module_id === msg.moduleId) {
                    regexScriptIds.push(r.id);
                  }
                }
              }
            } catch (err) {
              log.warn(`drawer.installModuleArtifacts: id-recovery list fetch threw`, err);
            }
          }
        } else {
          log.warn(
            `drawer.installModuleArtifacts: regex import HTTP ${resp.status} for module=${msg.moduleId}`,
          );
        }
      } catch (err) {
        log.warn(`drawer.installModuleArtifacts: regex pipeline threw`, err);
      }
    }

    sendToBackend({
      type: 'module_artifacts_installed',
      characterId: msg.characterId,
      moduleId: msg.moduleId,
      worldBookId,
      regexScriptIds,
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
    if (msg.worldBookId) {
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
      const listResp = await fetch(
        `/api/v1/regex-scripts?scope=character&character_id=${encodeURIComponent(msg.characterId)}&limit=2000`,
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
    // Skip per-chunk ack logging to avoid flooding on large imports.
    if (msg.type !== 'import_upload_ack' && msg.type !== 'module_upload_ack') {
      log.info(`drawer.handle: ${msg.type}`);
    }
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
      case 'import_upload_ack':
        onUploadAck(msg.sessionId, msg.seq, msg.receivedBytes);
        break;
      case 'import_progress':
        log.info(`drawer.import_progress: phase=${msg.phase} frac=${msg.fraction ?? '?'}`);
        if (activeUpload) {
          clearAckTimer(activeUpload);
          if (msg.phase === 'done' || msg.phase === 'error') activeUpload = null;
        }
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
        if (activeUpload && msg.sessionId === activeUpload.sessionId) {
          rejectAllPending(activeUpload, new Error(msg.message));
        }
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

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack argument-list limits on large files.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function generateSessionId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
