import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

export interface PermissionsModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupPermissionsModal(opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}): PermissionsModalHandle {
  const { ctx, log } = opts;
  void opts.sendToBackend;
  let current: SpindleModalHandle | null = null;
  let lastShownKey: string | null = null;

  function show(
    msg: Extract<BackendToFrontend, { type: 'notify_missing_permissions' }>,
  ): void {
    if (msg.missing.length === 0) {
      if (current) {
        try { current.dismiss(); } catch { /* */ }
        current = null;
      }
      lastShownKey = null;
      return;
    }
    const key = [...msg.missing].sort().join(',');
    if (key === lastShownKey) return;
    lastShownKey = key;
    if (current) {
      try { current.dismiss(); } catch { /* */ }
      current = null;
    }

    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: 'LumiRealm: missing permissions', width: 520 });
    } catch (err) {
      log.error('permissions-modal: showModal failed', err);
      return;
    }
    current = modal;

    const root = modal.root;
    root.classList.add('lr-alert-modal');

    const lead = document.createElement('p');
    lead.className = 'lr-alert-lead';
    lead.textContent = msg.missing.length === 1
      ? 'LumiRealm needs one permission that hasn\'t been granted.'
      : `LumiRealm needs ${msg.missing.length} permissions that haven\'t been granted.`;
    root.appendChild(lead);

    const list = document.createElement('ul');
    list.className = 'lr-alert-perm-list';
    for (const perm of msg.missing) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'lr-alert-card-name';
      name.textContent = perm;
      li.appendChild(name);
      const purpose = msg.purposes[perm];
      if (purpose) {
        li.appendChild(document.createTextNode(`: ${purpose}`));
      }
      list.appendChild(li);
    }
    root.appendChild(list);

    const note = document.createElement('div');
    note.className = 'lr-alert-note';
    const noteLabel = document.createElement('span');
    noteLabel.className = 'lr-alert-note-label';
    noteLabel.textContent = '⚠️';
    note.appendChild(noteLabel);
    note.appendChild(document.createTextNode(
      ' Grant them, then toggle LumiRealm ',
    ));
    const emphasis = document.createElement('span');
    emphasis.className = 'lr-alert-emphasize';
    emphasis.textContent = 'off and back on';
    note.appendChild(emphasis);
    note.appendChild(document.createTextNode(' in the Extensions panel.'));
    root.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'lr-alert-actions';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'lr-alert-ok';
    okBtn.textContent = 'Got it';
    okBtn.addEventListener('click', () => {
      try { modal.dismiss(); } catch { /* */ }
    });
    actions.appendChild(okBtn);
    root.appendChild(actions);

    modal.onDismiss(() => {
      if (current === modal) current = null;
    });

    queueMicrotask(() => { try { okBtn.focus(); } catch { /* */ } });
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type === 'notify_missing_permissions') show(msg);
    },
    destroy(): void {
      if (current) {
        try { current.dismiss(); } catch { /* */ }
        current = null;
      }
    },
  };
}
