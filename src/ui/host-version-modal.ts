import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

export interface HostVersionModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupHostVersionModal(opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}): HostVersionModalHandle {
  const { ctx, log } = opts;
  void opts.sendToBackend;
  let current: SpindleModalHandle | null = null;
  let shownThisSession = false;

  function show(
    msg: Extract<BackendToFrontend, { type: 'notify_host_version_outdated' }>,
  ): void {
    if (shownThisSession) return;
    shownThisSession = true;

    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: 'Update Lumiverse', width: 460 });
    } catch (err) {
      log.error('host-version-modal: showModal failed', err);
      return;
    }
    current = modal;

    const root = modal.root;
    root.classList.add('lr-alert-modal');

    const lead = document.createElement('p');
    lead.className = 'lr-alert-lead';
    lead.textContent = 'LumiRealm needs a newer Lumiverse to work correctly.';
    root.appendChild(lead);

    const detail = document.createElement('p');
    detail.className = 'lr-alert-message';
    const minSpan = document.createElement('span');
    minSpan.className = 'lr-alert-card-name';
    minSpan.textContent = msg.minimum;
    detail.appendChild(document.createTextNode('Required: Lumiverse '));
    detail.appendChild(minSpan);
    detail.appendChild(document.createTextNode(' or newer. '));
    if (msg.hostVersion) {
      detail.appendChild(document.createTextNode('This host is running '));
      const hostSpan = document.createElement('span');
      hostSpan.className = 'lr-alert-card-name';
      hostSpan.textContent = msg.hostVersion;
      detail.appendChild(hostSpan);
      detail.appendChild(document.createTextNode('.'));
    } else {
      detail.appendChild(document.createTextNode('Host version unknown.'));
    }
    root.appendChild(detail);

    const guidance = document.createElement('p');
    guidance.className = 'lr-alert-message';
    guidance.textContent = 'Some features may fail or behave unexpectedly until you update.';
    root.appendChild(guidance);

    const subnote = document.createElement('p');
    subnote.className = 'lr-alert-message';
    const dim = document.createElement('span');
    dim.style.fontSize = '0.85em';
    dim.style.opacity = '0.7';
    dim.textContent =
      '⚠️ If a newer update isn\'t avaliable, you may need to switch to ' +
      'the Lumiverse beta (staging). See the community guide on Discord.';
    subnote.appendChild(dim);
    root.appendChild(subnote);

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
      if (msg.type === 'notify_host_version_outdated') show(msg);
    },
    destroy(): void {
      if (current) {
        try { current.dismiss(); } catch { /* */ }
        current = null;
      }
    },
  };
}
