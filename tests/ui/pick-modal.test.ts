import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setupPickModal } from '../../src/ui/pick-modal';

test('forwarded selections preserve duplicate and empty option indexes', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  const root = document.createElement('div');
  let dismissed = () => {};
  const sent: unknown[] = [];
  const ctx = { ui: { showModal: () => ({ root, dismiss: () => dismissed(), onDismiss: (callback: () => void) => { dismissed = callback; } }) } } as unknown as SpindleFrontendContext;
  const controller = setupPickModal({ ctx, sendToBackend: message => { sent.push(message); },
    log: { debug() {}, info() {}, warn() {}, error() {}, trace() {} },
  });
  try {
    controller.handleBackendMessage({ type: 'request_pick', requestId: 'pick', title: 'Pick', options: ['Same', '', 'Same'] });
    const buttons = root.querySelectorAll<HTMLButtonElement>('.lr-pick-option');
    expect(Array.from(buttons, button => button.textContent)).toEqual(['Same', '', 'Same']);
    buttons[2]!.click();
    expect(sent).toEqual([{ type: 'pick_resolved', requestId: 'pick', value: '2' }]);
    await Promise.resolve();
  } finally {
    controller.destroy();
    if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document');
    await window.happyDOM.close();
  }
});
