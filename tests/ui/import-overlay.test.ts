import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { setupImportOverlay, type ImportOverlayHandle } from '../../src/ui/import-overlay.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

let window: Window;
let overlay: ImportOverlayHandle;
let originalDocument: PropertyDescriptor | undefined;
const sent: unknown[] = [];

beforeEach(() => {
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  sent.length = 0;
  overlay = setupImportOverlay({ info() {}, warn() {} }, message => sent.push(message));
  overlay.notifyImportStart('First', 'drawer');
  overlay.handleBackendMessage({ type: 'import_progress', phase: 'done', message: '', fraction: 1 });
});

afterEach(() => {
  overlay.destroy();
  window.happyDOM.cancelAsync();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

const nextMessages: BackendToFrontend[] = [
  { type: 'import_progress', phase: 'decoding', message: 'Next import', fraction: null },
  { type: 'import_progress', phase: 'error', message: 'Next import failed', fraction: null },
  { type: 'consent_prompt', requestId: 'next', title: 'Next import', message: 'Allow?', confirmLabel: 'Grant', cancelLabel: 'Decline' },
];

test.each(nextMessages)('previous completion cannot hide $type/$phase', async message => {
  overlay.handleBackendMessage(message);
  await Bun.sleep(1300);
  expect(window.document.querySelector('.lr-import-overlay')!.hasAttribute('hidden')).toBe(false);
  if (message.type === 'consent_prompt') {
    window.document.querySelector('.lr-import-consent-buttons .lrm-btn-primary')!.dispatchEvent(new window.MouseEvent('click'));
    expect(sent).toEqual([{ type: 'consent_response', requestId: 'next', confirmed: true }]);
  }
});

test('completed imports still close automatically', async () => {
  await Bun.sleep(1300);
  expect(window.document.querySelector('.lr-import-overlay')!.hasAttribute('hidden')).toBe(true);
});
