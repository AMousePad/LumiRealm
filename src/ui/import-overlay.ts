import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import { currentTask, startTask, finishTask } from './busy.js';

export interface ImportOverlayLog {
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
}

export interface ImportOverlayHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  notifyImportStart(
    label: string,
    source: 'realm' | 'drawer' | 'module',
    onCancel?: () => void,
    totalBytes?: number,
  ): boolean;
  notifyImportError(message: string): void;
  setUploadProgress(sent: number, total: number): void;
  destroy(): void;
}

const PHASE_LABEL: Record<string, string> = {
  decoding: 'Decoding',
  translating: 'Translating',
  creating_character: 'Creating character',
  uploading_assets: 'Uploading assets',
  saving_payload: 'Saving',
  done: 'Done',
  error: 'Error',
};

const AUTO_HIDE_DELAY_MS = 1200;

export function setupImportOverlay(
  log: ImportOverlayLog,
  sendToBackend: (msg: FrontendToBackend) => void,
): ImportOverlayHandle {
  const overlay = document.createElement('div');
  overlay.className = 'lr-import-overlay';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  const card = document.createElement('div');
  card.className = 'lr-import-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Operation progress');
  card.setAttribute('aria-live', 'polite');
  overlay.appendChild(card);

  const minimizeBtn = document.createElement('button');
  minimizeBtn.type = 'button';
  minimizeBtn.className = 'lrm-btn lr-import-minimize';
  minimizeBtn.textContent = 'Minimize';
  minimizeBtn.setAttribute('aria-expanded', 'true');
  minimizeBtn.addEventListener('click', () => {
    const minimized = overlay.classList.toggle('lr-import-minimized');
    minimizeBtn.textContent = minimized ? 'Expand' : 'Minimize';
    minimizeBtn.setAttribute('aria-expanded', String(!minimized));
  });
  card.appendChild(minimizeBtn);

  const titleEl = document.createElement('div');
  titleEl.className = 'lr-import-title';
  card.appendChild(titleEl);

  const phaseEl = document.createElement('div');
  phaseEl.className = 'lr-import-phase';
  card.appendChild(phaseEl);

  const messageEl = document.createElement('div');
  messageEl.className = 'lr-import-message';
  card.appendChild(messageEl);

  const consentEl = document.createElement('div');
  consentEl.className = 'lr-import-consent';
  consentEl.hidden = true;
  const consentMsg = document.createElement('div');
  consentMsg.className = 'lr-import-consent-message';
  consentEl.appendChild(consentMsg);
  const consentBtnRow = document.createElement('div');
  consentBtnRow.className = 'lr-import-consent-buttons';
  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'lrm-btn lrm-btn-secondary';
  const grantBtn = document.createElement('button');
  grantBtn.type = 'button';
  grantBtn.className = 'lrm-btn lrm-btn-primary';
  consentBtnRow.appendChild(declineBtn);
  consentBtnRow.appendChild(grantBtn);
  consentEl.appendChild(consentBtnRow);
  card.appendChild(consentEl);

  const progressOuter = document.createElement('div');
  progressOuter.className = 'lr-import-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'lr-import-progress-fill';
  progressOuter.appendChild(progressInner);
  card.appendChild(progressOuter);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'lr-import-button-row';
  card.appendChild(buttonRow);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'lrm-btn lrm-btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.hidden = true;
  buttonRow.appendChild(cancelBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'lrm-btn lrm-btn-primary';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.hidden = true;
  dismissBtn.addEventListener('click', () => hideNow());
  buttonRow.appendChild(dismissBtn);

  let visible = false;
  let label = '';
  let lastPhase: string = '';
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingConsentRequestId: string | null = null;
  let pendingCancel: (() => void) | null = null;
  let uploadTotalBytes = 0;
  let importing = false;
  const queuedOperations = new Map<string, Extract<BackendToFrontend, { type: 'operation_progress' }>>();

  function setIndeterminate(): void {
    progressOuter.classList.add('lr-import-progress-indeterminate');
    progressInner.style.width = '40%';
  }

  function setFraction(frac: number): void {
    progressOuter.classList.remove('lr-import-progress-indeterminate');
    const clamped = Math.max(0, Math.min(1, frac));
    progressInner.style.width = `${clamped * 100}%`;
  }

  function cancelHide(): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  function showOverlay(newLabel: string): void {
    cancelHide();
    label = newLabel;
    visible = true;
    lastPhase = '';
    titleEl.textContent = `Importing ${label}`;
    phaseEl.textContent = 'Starting';
    messageEl.textContent = 'Preparing import…';
    progressOuter.classList.remove('lr-import-progress-error');
    setIndeterminate();
    dismissBtn.hidden = true;
    consentEl.hidden = true;
    overlay.hidden = false;
    log.info(`import-overlay: show label=${label}`);
  }

  function lockCancel(): void {
    pendingCancel = null;
    cancelBtn.hidden = true;
  }

  cancelBtn.addEventListener('click', () => {
    const cb = pendingCancel;
    pendingCancel = null;
    cancelBtn.hidden = true;
    if (cb) {
      try { cb(); } catch (err) { log.warn('import-overlay: cancel callback threw', err); }
    }
    importing = false;
    finishTask('import');
    hideNow();
  });

  function hideNow(): void {
    cancelHide();
    visible = false;
    overlay.hidden = true;
    log.info('import-overlay: hidden');
    activeOperationId = null;
    const next = queuedOperations.values().next().value;
    if (next) { queuedOperations.delete(next.operationId); applyOperationProgress(next); }
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      hideNow();
    }, AUTO_HIDE_DELAY_MS);
  }

  function applyProgress(phase: string, message: string, fraction: number | null): void {
    cancelHide();
    phaseEl.textContent = PHASE_LABEL[phase] ?? phase;
    messageEl.textContent = message || '';
    lastPhase = phase;
    lockCancel();
    if (phase === 'done') {
      importing = false;
      finishTask('import');
      titleEl.classList.remove('lr-busy');
      progressOuter.classList.remove('lr-import-progress-error');
      setFraction(1);
      dismissBtn.hidden = true;
      consentEl.hidden = true;
      scheduleHide();
      return;
    }
    if (phase === 'error') {
      expand();
      importing = false;
      finishTask('import');
      titleEl.classList.remove('lr-busy');
      progressOuter.classList.add('lr-import-progress-error');
      setFraction(1);
      dismissBtn.hidden = false;
      consentEl.hidden = true;
      return;
    }
    if (typeof fraction === 'number') {
      setFraction(fraction);
    } else {
      setIndeterminate();
    }
  }

  // Background cleanup must not replace a running import or consent request.
  let activeOperationId: string | null = null;
  function applyOperationProgress(
    msg: Extract<BackendToFrontend, { type: 'operation_progress' }>,
  ): void {
    activeOperationId = msg.operationId;
    titleEl.classList.toggle('lr-busy', msg.phase === 'started' || msg.phase === 'progress');
    cancelHide();
    if (msg.phase === 'started' || !visible) {
      visible = true;
      lastPhase = '';
      progressOuter.classList.remove('lr-import-progress-error');
      consentEl.hidden = true;
      dismissBtn.hidden = true;
      cancelBtn.hidden = true;
      pendingCancel = null;
      overlay.hidden = false;
    }
    titleEl.textContent = msg.title;
    if (msg.phase === 'error') {
      expand();
      finishTask(msg.operationId);
      progressOuter.classList.add('lr-import-progress-error');
      phaseEl.textContent = 'Error';
      messageEl.textContent = msg.error || msg.message || 'Operation failed';
      setFraction(1);
      dismissBtn.hidden = false;
      return;
    }
    if (msg.phase === 'done') {
      finishTask(msg.operationId);
      progressOuter.classList.remove('lr-import-progress-error');
      phaseEl.textContent = 'Done';
      messageEl.textContent = msg.message || '';
      setFraction(1);
      scheduleHide();
      return;
    }
    phaseEl.textContent = msg.phase === 'started' ? 'Starting' : 'Working';
    messageEl.textContent = msg.message || '';
    if (typeof msg.fraction === 'number') {
      setFraction(msg.fraction);
    } else {
      setIndeterminate();
    }
  }

  function expand(): void {
    overlay.classList.remove('lr-import-minimized');
    minimizeBtn.textContent = 'Minimize';
    minimizeBtn.setAttribute('aria-expanded', 'true');
  }

  function showConsent(prompt: Extract<BackendToFrontend, { type: 'consent_prompt' }>): void {
    cancelHide();
    if (!visible) showOverlay(label || 'character');
    pendingConsentRequestId = prompt.requestId;
    expand();
    titleEl.textContent = prompt.title;
    phaseEl.textContent = 'Awaiting consent';
    messageEl.textContent = '';
    consentMsg.textContent = prompt.message;
    grantBtn.textContent = prompt.confirmLabel;
    declineBtn.textContent = prompt.cancelLabel;
    grantBtn.disabled = false;
    declineBtn.disabled = false;
    consentEl.hidden = false;
    setIndeterminate();
    log.info(`import-overlay: consent prompt requestId=${prompt.requestId}`);
  }

  function resolveConsent(confirmed: boolean): void {
    const requestId = pendingConsentRequestId;
    if (!requestId) return;
    pendingConsentRequestId = null;
    grantBtn.disabled = true;
    declineBtn.disabled = true;
    consentEl.hidden = true;
    log.info(`import-overlay: consent response requestId=${requestId} confirmed=${confirmed}`);
    sendToBackend({ type: 'consent_response', requestId, confirmed });
  }

  grantBtn.addEventListener('click', () => resolveConsent(true));
  declineBtn.addEventListener('click', () => resolveConsent(false));

  function notifyImportStart(
    newLabel: string,
    source: 'realm' | 'drawer' | 'module',
    onCancel?: () => void,
    totalBytes?: number,
  ): boolean {
    if (!startTask({ id: 'import', kind: 'import', label: newLabel })) return false;
    importing = true;
    activeOperationId = null;
    log.info(`import-overlay: notifyImportStart label=${newLabel} source=${source} cancellable=${!!onCancel} totalBytes=${totalBytes ?? '?'}`);
    uploadTotalBytes = typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : 0;
    showOverlay(newLabel);
    pendingCancel = onCancel ?? null;
    cancelBtn.hidden = !pendingCancel;
    titleEl.classList.add('lr-busy');
    return true;
  }

  function setUploadProgress(sent: number, total: number): void {
    if (!importing) return;
    if (!visible) showOverlay(label || 'character');
    if (lastPhase !== '') return;
    phaseEl.textContent = 'Uploading';
    if (total > 0) {
      messageEl.textContent = `Sent ${formatBytes(Math.min(sent, total))} of ${formatBytes(total)}…`;
      setFraction(sent / total);
      if (sent >= total) lockCancel();
    } else {
      messageEl.textContent = `Sent ${formatBytes(sent)}…`;
    }
  }

  function handleBackendMessage(msg: BackendToFrontend): void {
    switch (msg.type) {
      case 'realm_download_started': {
        if (msg.ok) {
          const isPlaceholder = !!msg.fileName && /^realm-[0-9a-f-]+\.[a-z0-9]+$/i.test(msg.fileName);
          const preferred = isPlaceholder ? label : (msg.fileName ?? label);
          if (!visible) showOverlay(preferred || 'character');
          else titleEl.textContent = `Importing ${preferred || 'character'}`;
        } else if (visible) {
          applyProgress('error', msg.error ?? 'Download failed', null);
        }
        break;
      }
      case 'import_progress': {
        if (!visible && msg.phase !== 'done' && msg.phase !== 'error') {
          showOverlay(label || 'character');
        }
        if (visible) applyProgress(msg.phase, msg.message, msg.fraction ?? null);
        break;
      }
      case 'consent_prompt': {
        showConsent(msg);
        break;
      }
      case 'operation_progress': {
        if (importing || pendingConsentRequestId || (activeOperationId && activeOperationId !== msg.operationId && visible)) {
          queuedOperations.set(msg.operationId, msg);
          if (msg.phase === 'done' || msg.phase === 'error') finishTask(msg.operationId);
          break;
        }
        applyOperationProgress(msg);
        break;
      }
      case 'rasterize_svgs': {
        if (visible) {
          phaseEl.textContent = 'Rasterizing SVGs';
          messageEl.textContent = `Rasterizing ${msg.svgs.length} SVG${msg.svgs.length === 1 ? '' : 's'}…`;
          setIndeterminate();
        }
        break;
      }
    }
  }

  function destroy(): void {
    cancelHide();
    if (importing) { pendingCancel?.(); finishTask('import'); }
    if (activeOperationId) finishTask(activeOperationId);
    const task = currentTask();
    if (task) finishTask(task.id);
    overlay.remove();
  }

  return { handleBackendMessage, notifyImportStart, setUploadProgress, notifyImportError: message => { if (importing) applyProgress('error', message, null); }, destroy };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
