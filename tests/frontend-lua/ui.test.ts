import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { createFrontendLuaUi } from '../../src/frontend-lua/ui';
import { FrontendLuaUnavailableError } from '../../src/frontend-lua/protocol';

test('Lua modals retain their styling and independent cancellation', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
  document.head.appendChild(style);
  const modals: { root: HTMLElement; dismissed: boolean; dismiss(): void; onDismiss(callback: () => void): void }[] = [];
  const ctx = { ui: { showModal() {
    const callbacks: (() => void)[] = [];
    const modal = { root: document.createElement('div'), dismissed: false,
      dismiss() { if (!this.dismissed) { this.dismissed = true; for (const callback of callbacks) callback(); } },
      onDismiss(callback: () => void) { callbacks.push(callback); },
    };
    document.body.appendChild(modal.root);
    modals.push(modal); return modal;
  } } } as unknown as SpindleFrontendContext;
  const ui = createFrontendLuaUi(ctx);
  try {
    const alert = ui.api().alert!('Language changed').catch(error => error);
    const alertButton = window.document.querySelector('button')!;
    expect(window.getComputedStyle(alertButton).padding).toBe('7px 18px');
    expect(window.getComputedStyle(window.document.querySelector('p')!).whiteSpace).toBe('pre-wrap');
    alertButton.click();
    expect(await alert).toBeUndefined();
    modals.length = 0;
    const controller = new AbortController(), reason = new Error('Cancelled');
    const first = ui.api(controller.signal).prompt!('<b>Literal text</b>').catch(error => error);
    const second = ui.api().prompt!('Keep this prompt', 'value');
    expect(modals[0]!.root.querySelector('b')).toBeNull();
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect(modals.map(modal => modal.dismissed)).toEqual([true, false]);
    modals[1]!.root.querySelector('button')!.click();
    expect(await second).toBe('value');
    const third = ui.api().prompt!('Close with runtime').catch(error => error);
    ui.dispose();
    expect(await third).toBeInstanceOf(FrontendLuaUnavailableError);
    expect(modals.every(modal => modal.dismissed)).toBe(true);
    await expect(ui.api(controller.signal).prompt!('Already cancelled')).rejects.toBe(reason);
    expect(modals).toHaveLength(3);
  } finally {
    ui.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    await window.happyDOM.close();
  }
});
