import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { HostApi } from '../interpreter/host.js';
import { FrontendLuaUnavailableError } from './protocol.js';

type AlertMode = 'alert' | 'input' | 'select' | 'confirm';
interface AlertWaiter { mode: AlertMode; resolve(value: string | null): void; reject(error: unknown): void }

export function createFrontendLuaUi(ctx: SpindleFrontendContext) {
  const pending = new Set<AlertWaiter>();
  let modal: SpindleModalHandle | undefined;
  let current: AlertWaiter | undefined;
  let value: string | null = null;
  function show(title: string, message: string, choices: readonly string[], input?: string, signal?: AbortSignal, mode: AlertMode = 'alert'): Promise<string | null> {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const cleanup = () => { pending.delete(waiter); signal?.removeEventListener('abort', abort); };
      const waiter = {
        mode,
        resolve(result: string | null) { cleanup(); resolve(result); },
        reject(error: unknown) { cleanup(); reject(error); },
      };
      const abort = () => { waiter.reject(signal!.reason); if (current === waiter) modal?.dismiss(); };
      pending.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (!modal) {
          modal = ctx.ui.showModal({ title, width: 420 });
          modal.onDismiss(() => {
            modal = undefined;
            current = undefined;
            for (const call of pending) if (call.mode === 'alert') call.resolve(value);
          });
        } else {
          modal.setTitle(title);
        }
      } catch (error) {
        waiter.reject(error);
        return;
      }
      // Risu's alert store replaces the dialog; all waitAlert callers read its final result.
      if (current?.mode === 'alert') current.resolve('');
      current = waiter;
      value = null;
      modal.root.replaceChildren();
      modal.root.classList.remove('lr-pick-modal', 'lr-alert-modal');
      modal.root.classList.add(mode === 'select' ? 'lr-pick-modal' : 'lr-alert-modal');
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
      actions.className = mode === 'select' ? 'lr-pick-list' : 'lr-alert-actions';
      modal.root.appendChild(actions);
      for (const [index, choice] of choices.entries()) {
        const button = document.createElement('button');
        button.className = mode === 'select' ? 'lr-pick-option' : 'lr-alert-ok';
        button.type = 'button';
        button.textContent = choice;
        button.addEventListener('click', () => {
          if (current !== waiter) return;
          value = mode === 'select' ? String(index) : mode === 'input' ? field!.value : mode === 'confirm' ? (index === 0 ? 'yes' : 'no') : '';
          modal!.dismiss();
        });
        actions.appendChild(button);
      }
      field?.focus();
      if (mode !== 'alert') void (async () => {
        // Match waitAlert polling so a synchronous replacement after dismissal remains pending.
        while (modal && pending.has(waiter)) await new Promise(resolve => setTimeout(resolve, 10));
        if (pending.has(waiter)) waiter.resolve(value);
      })();
    });
  }
  const api = (signal?: AbortSignal): NonNullable<HostApi['ui']> => ({
    alert: async message => { await show('', message, ['OK'], undefined, signal); },
    prompt: (message, value = '') => show('', message, ['OK'], value, signal, 'input'),
    pick: (title, values) => show(title, '', values, undefined, signal, 'select'),
    confirm: async message => await show('Confirm', message, ['Yes', 'No'], undefined, signal, 'confirm') === 'yes',
  });
  return { api, dispose() {
    for (const call of pending) call.reject(new FrontendLuaUnavailableError('The browser Lua runtime closed'));
    modal?.dismiss();
  } };
}
