import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { HostApi } from '../interpreter/host.js';
import { FrontendLuaUnavailableError } from './protocol.js';

export function createFrontendLuaUi(ctx: SpindleFrontendContext) {
  const open = new Map<SpindleModalHandle, (error: Error) => void>();
  function show(title: string, message: string, choices: readonly string[], input?: string, signal?: AbortSignal, list = false): Promise<string | null> {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const modal = ctx.ui.showModal({ title, width: 420 });
      modal.root.classList.add(list ? 'lr-pick-modal' : 'lr-alert-modal');
      open.set(modal, reject);
      let value: string | null = null;
      const description = document.createElement('p');
      description.className = 'lr-alert-message';
      description.textContent = message;
      modal.root.appendChild(description);
      let field: HTMLInputElement | undefined;
      if (input !== undefined) {
        field = document.createElement('input');
        field.value = input;
        modal.root.appendChild(field);
      }
      const actions = document.createElement('div');
      actions.className = list ? 'lr-pick-list' : 'lr-alert-actions';
      modal.root.appendChild(actions);
      for (const choice of choices) {
        const button = document.createElement('button');
        button.className = list ? 'lr-pick-option' : 'lr-alert-ok';
        button.type = 'button';
        button.textContent = choice;
        button.addEventListener('click', () => { value = field?.value ?? choice; modal.dismiss(); });
        actions.appendChild(button);
      }
      const abort = () => { reject(signal!.reason); modal.dismiss(); };
      signal?.addEventListener('abort', abort, { once: true });
      modal.onDismiss(() => { signal?.removeEventListener('abort', abort); open.delete(modal); resolve(value); });
      field?.focus();
    });
  }
  const api = (signal?: AbortSignal): NonNullable<HostApi['ui']> => ({
    alert: async message => { await show('', message, ['OK'], undefined, signal); },
    prompt: (message, value = '') => show('', message, ['OK'], value, signal),
    pick: (title, values) => show(title, '', values, undefined, signal, true),
    confirm: async message => await show('Confirm', message, ['Yes', 'No'], undefined, signal) === 'Yes',
  });
  return { api, dispose() {
    for (const [modal, reject] of open) { reject(new FrontendLuaUnavailableError('The browser Lua runtime closed')); modal.dismiss(); }
    open.clear();
  } };
}
