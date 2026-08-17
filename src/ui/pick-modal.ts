import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

// Owned select-from-list modal. Backend sends `request_pick`; we mount via
// ctx.ui.showModal with a real list of buttons and reply with `pick_resolved`
// when the user picks one (or null when dismissed).

export interface PickModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupPickModal(opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}): PickModalHandle {
  const { ctx, sendToBackend, log } = opts;
  const open = new Map<string, SpindleModalHandle>();

  function show(msg: Extract<BackendToFrontend, { type: 'request_pick' }>): void {
    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: msg.title || '', width: 420 });
    } catch (err) {
      log.error('pick-modal: showModal failed', err);
      sendToBackend({ type: 'pick_resolved', requestId: msg.requestId, value: null });
      return;
    }
    open.set(msg.requestId, modal);

    let chosen: string | null = null;

    const root = modal.root;
    root.classList.add('lr-pick-modal');

    const list = document.createElement('div');
    list.className = 'lr-pick-list';
    for (const opt of msg.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lr-pick-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        chosen = opt;
        try { modal.dismiss(); } catch { /* */ }
      });
      list.appendChild(btn);
    }
    root.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'lr-pick-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lr-pick-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      chosen = null;
      try { modal.dismiss(); } catch { /* */ }
    });
    actions.appendChild(cancel);
    root.appendChild(actions);

    modal.onDismiss(() => {
      open.delete(msg.requestId);
      sendToBackend({ type: 'pick_resolved', requestId: msg.requestId, value: chosen });
    });

    queueMicrotask(() => {
      try { (list.firstElementChild as HTMLButtonElement | null)?.focus(); } catch { /* */ }
    });
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type === 'request_pick') show(msg);
    },
    destroy(): void {
      for (const m of open.values()) {
        try { m.dismiss(); } catch { /* */ }
      }
      open.clear();
    },
  };
}
