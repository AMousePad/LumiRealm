import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

// One-time 0.2.4 -> 0.3 transition notice. Cards imported before raw-source
// storage shipped don't auto-migrate, so the user needs to re-import once.

export interface LegacyReimportModalHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export function setupLegacyReimportModal(opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}): LegacyReimportModalHandle {
  const { ctx, log } = opts;
  void opts.sendToBackend;
  const open = new Map<string, SpindleModalHandle>();
  const shownThisSession = new Set<string>();

  function show(
    msg: Extract<BackendToFrontend, { type: 'notify_legacy_card_needs_reimport' }>,
  ): void {
    if (shownThisSession.has(msg.characterId)) return;
    shownThisSession.add(msg.characterId);

    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({ title: 'Legacy Card Detected', width: 460 });
    } catch (err) {
      log.error('legacy-reimport-modal: showModal failed', err);
      return;
    }
    open.set(msg.characterId, modal);

    const root = modal.root;
    root.classList.add('lr-alert-modal');

    const lead = document.createElement('p');
    lead.className = 'lr-alert-lead';
    lead.textContent = 'If you notice any issues with this card, please re-import it.';
    root.appendChild(lead);

    const context = document.createElement('p');
    context.className = 'lr-alert-message';
    const nameEl = document.createElement('span');
    nameEl.className = 'lr-alert-card-name';
    nameEl.textContent = msg.characterName;
    context.appendChild(nameEl);
    context.appendChild(
      document.createTextNode(
        ' was imported before LumiRealm 0.3.0. Future translator updates apply ' +
          'automatically only to cards imported on 0.3.0 or later.',
      ),
    );
    root.appendChild(context);

    const guidance = document.createElement('p');
    guidance.className = 'lr-alert-message';
    guidance.textContent =
      'You only need to re-import this card if you notice something rendering incorrectly. ' +
      'This is a one-time prompt.';
    root.appendChild(guidance);

    const note = document.createElement('p');
    note.className = 'lr-alert-note';
    const label = document.createElement('span');
    label.className = 'lr-alert-note-label';
    label.textContent = 'Note:';
    note.appendChild(label);
    note.appendChild(
      document.createTextNode(
        ' you will never need to re-import cards imported from today onward. ' +
          'This is a one-time improvement to our translator pipeline.',
      ),
    );
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
      open.delete(msg.characterId);
    });

    queueMicrotask(() => { try { okBtn.focus(); } catch { /* */ } });
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type === 'notify_legacy_card_needs_reimport') show(msg);
    },
    destroy(): void {
      for (const m of open.values()) {
        try { m.dismiss(); } catch { /* */ }
      }
      open.clear();
    },
  };
}
