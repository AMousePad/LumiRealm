import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';

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
  ): void;
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
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-live', 'polite');
  document.body.appendChild(overlay);

  const card = document.createElement('div');
  card.className = 'lr-import-card';
  overlay.appendChild(card);

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

  function setIndeterminate(): void {
    progressOuter.classList.add('lr-import-progress-indeterminate');
    progressInner.style.width = '40%';
  }

  function setFraction(frac: number): void {
    progressOuter.classList.remove('lr-import-progress-indeterminate');
    const clamped = Math.max(0, Math.min(1, frac));
    progressInner.style.width = `${clamped * 100}%`;
  }

  function showOverlay(newLabel: string): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
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
    hideNow();
  });

  function hideNow(): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    visible = false;
    overlay.hidden = true;
    log.info('import-overlay: hidden');
  }

  function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      hideNow();
    }, AUTO_HIDE_DELAY_MS);
  }

  function applyProgress(phase: string, message: string, fraction: number | null): void {
    phaseEl.textContent = PHASE_LABEL[phase] ?? phase;
    messageEl.textContent = message || '';
    lastPhase = phase;
    lockCancel();
    if (phase === 'done') {
      progressOuter.classList.remove('lr-import-progress-error');
      setFraction(1);
      dismissBtn.hidden = true;
      consentEl.hidden = true;
      scheduleHide();
      return;
    }
    if (phase === 'error') {
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

  // Generic operation driver for non-import flows (deletes, cleanup). Reuses
  // the same modal so the user gets identical visual feedback.
  let activeOperationId: string | null = null;
  function applyOperationProgress(
    msg: Extract<BackendToFrontend, { type: 'operation_progress' }>,
  ): void {
    activeOperationId = msg.operationId;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
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
      progressOuter.classList.add('lr-import-progress-error');
      phaseEl.textContent = 'Error';
      messageEl.textContent = msg.error || msg.message || 'Operation failed';
      setFraction(1);
      dismissBtn.hidden = false;
      return;
    }
    if (msg.phase === 'done') {
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

  function showConsent(prompt: Extract<BackendToFrontend, { type: 'consent_prompt' }>): void {
    if (!visible) showOverlay(label || 'character');
    pendingConsentRequestId = prompt.requestId;
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
  ): void {
    log.info(`import-overlay: notifyImportStart label=${newLabel} source=${source} cancellable=${!!onCancel} totalBytes=${totalBytes ?? '?'}`);
    uploadTotalBytes = typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : 0;
    showOverlay(newLabel);
    pendingCancel = onCancel ?? null;
    cancelBtn.hidden = !pendingCancel;
  }

  function setUploadProgress(sent: number, total: number): void {
    if (!visible) showOverlay(label || 'character');
    if (lastPhase !== '') return;
    phaseEl.textContent = 'Uploading';
    if (total > 0) {
      messageEl.textContent = `Sent ${formatBytes(Math.min(sent, total))} of ${formatBytes(total)}…`;
      setFraction(sent / total);
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
      case 'module_upload_ack': {
        if (!visible && msg.seq === -1) {
          showOverlay(label || 'character');
        }
        if (visible && lastPhase === '') {
          phaseEl.textContent = 'Uploading';
          if (uploadTotalBytes > 0) {
            const sent = Math.min(msg.receivedBytes, uploadTotalBytes);
            messageEl.textContent =
              `Sent ${formatBytes(sent)} of ${formatBytes(uploadTotalBytes)} to backend…`;
            setFraction(sent / uploadTotalBytes);
          } else {
            messageEl.textContent = `Sent ${formatBytes(msg.receivedBytes)} to backend…`;
          }
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
      case 'error': {
        if (visible && lastPhase !== 'done') applyProgress('error', msg.message, null);
        break;
      }
    }
  }

  function destroy(): void {
    if (hideTimer) clearTimeout(hideTimer);
    overlay.remove();
  }

  return { handleBackendMessage, notifyImportStart, setUploadProgress, destroy };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
