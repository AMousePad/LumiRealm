import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { setupImportOverlay, type ImportOverlayHandle } from '../../src/ui/import-overlay.js';
import type { BackendToFrontend } from '../../src/types/messages.js';
import { currentTask } from '../../src/ui/busy.js';

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

test('keeps the progress bar when minimized and expands errors', () => {
  expect(overlay.notifyImportStart('Example', 'module')).toBe(true);
  expect(overlay.notifyImportStart('Duplicate', 'drawer')).toBe(false);
  overlay.setUploadProgress(25, 100);
  const panel = window.document.querySelector('.lr-import-overlay')!;
  expect(panel.querySelector('[aria-modal="true"]')).toBeNull();
  const minimize = panel.querySelector('button.lr-import-minimize')!;
  minimize.dispatchEvent(new window.MouseEvent('click'));
  expect(panel.classList.contains('lr-import-minimized')).toBe(true);
  expect(panel.querySelector('.lr-import-progress-fill')!.getAttribute('style')).toContain('width: 25%');
  overlay.notifyImportError('Upload failed');
  expect(panel.classList.contains('lr-import-minimized')).toBe(false);
  expect(panel.textContent).toContain('Upload failed');
  expect(currentTask()).toBeNull();
});

test('unrelated errors and cleanup cannot replace or finish an import', () => {
  overlay.notifyImportStart('Example', 'module');
  overlay.handleBackendMessage({ type: 'error', message: 'Unrelated failure' });
  const cleanup = { type: 'operation_progress', operationId: 'cleanup', title: 'Cleanup', message: '', fraction: null } as const;
  overlay.handleBackendMessage({ ...cleanup, phase: 'started' });
  overlay.handleBackendMessage({ ...cleanup, phase: 'error', error: 'Cleanup failed' });
  expect(window.document.querySelector('.lr-import-title')!.textContent).toBe('Importing Example');
  expect(currentTask()?.id).toBe('import');
  overlay.notifyImportError('Import failed');
  const dismiss = Array.from(window.document.querySelectorAll('button')).find(button => button.textContent === 'Dismiss')!;
  dismiss.click();
  expect(window.document.querySelector('.lr-import-title')!.textContent).toBe('Cleanup');
  expect(window.document.querySelector('.lr-import-message')!.textContent).toBe('Cleanup failed');
});

test('cancel unlocks the upload and late transport progress cannot reopen it', () => {
  let cancelled = false;
  overlay.notifyImportStart('Example', 'drawer', () => { cancelled = true; });
  const cancel = Array.from(window.document.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!;
  cancel.click();
  overlay.setUploadProgress(30, 100);
  expect(cancelled).toBe(true);
  expect(currentTask()).toBeNull();
  expect(window.document.querySelector('.lr-import-overlay')!.hasAttribute('hidden')).toBe(true);
});
