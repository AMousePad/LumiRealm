import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

// Owned alert modal. Backend sends `request_alert`; we mount via
// ctx.ui.showModal with our own DOM (just message + OK button) and
// reply with `alert_dismissed` once the user closes it.

export interface AlertModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupAlertModal(opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}): AlertModalHandle {
  const { ctx, sendToBackend, log } = opts;
  const open = new Map<string, SpindleModalHandle>();

  function show(msg: Extract<BackendToFrontend, { type: 'request_alert' }>): void {
    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: '', width: 380 });
    } catch (err) {
      log.error('alert-modal: showModal failed', err);
      sendToBackend({ type: 'alert_dismissed', requestId: msg.requestId });
      return;
    }
    open.set(msg.requestId, modal);

    const root = modal.root;
    root.classList.add('lr-alert-modal');
    if (msg.kind === 'error') root.classList.add('lr-alert-error');

    const messageEl = document.createElement('p');
    messageEl.className = 'lr-alert-message';
    messageEl.textContent = msg.message;
    root.appendChild(messageEl);

    const actions = document.createElement('div');
    actions.className = 'lr-alert-actions';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'lr-alert-ok';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => {
      try { modal.dismiss(); } catch { /* */ }
    });
    actions.appendChild(okBtn);
    root.appendChild(actions);

    modal.onDismiss(() => {
      open.delete(msg.requestId);
      sendToBackend({ type: 'alert_dismissed', requestId: msg.requestId });
    });

    queueMicrotask(() => { try { okBtn.focus(); } catch { /* */ } });
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type === 'request_alert') show(msg);
    },
    destroy(): void {
      for (const m of open.values()) {
        try { m.dismiss(); } catch { /* */ }
      }
      open.clear();
    },
  };
}
