/**
 * Pin the Presets panel's opt-in label translation (`ui/modules-tab.ts`):
 *   - opening the Presets subtab asks the host for the user's connection list,
 *   - the profile select stays disabled until a profile exists and the user
 *     opts in,
 *   - the import message carries the chosen connection id only when opted in.
 * The upload transport and the native file picker are mocked.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Window } from 'happy-dom';
import type { BackendToFrontend, FrontendToBackend } from '../../src/types/messages.js';

interface FakeUploadOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
  onProgress?: (sent: number, total: number) => void;
}

const uploads: Array<{ options: FakeUploadOptions; url?: string; started: boolean }> = [];

class FakeUpload {
  readonly url: string | undefined = undefined;
  constructor(_file: unknown, private readonly options: FakeUploadOptions) {
    uploads.push(this as unknown as { options: FakeUploadOptions; started: boolean });
  }
  start(): void {
    (uploads[uploads.length - 1] as { started: boolean }).started = true;
  }
  async abort(_force?: boolean): Promise<void> {}
}

mock.module('tus-js-client', () => ({ Upload: FakeUpload }));
mock.module('../../src/ui/native-file-picker.js', () => ({
  pickNativeFile: async () => ({ name: 'synthetic.risup', size: 4096 }),
}));

const { mountModulesPanel } = await import('../../src/ui/modules-tab.js');
type ModulesPanelHandle = ReturnType<typeof mountModulesPanel>;

let window: Window;
let originalDocument: Document | undefined;

beforeEach(() => {
  uploads.length = 0;
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

const CONNECTIONS = [
  { id: 'conn-1', name: 'Lumi Main', provider: 'openai', model: 'gpt-4o', is_default: true },
  { id: 'conn-2', name: 'Cheap Local', provider: 'ollama', model: 'llama3', is_default: false },
];

function build(): {
  root: HTMLElement;
  panel: ModulesPanelHandle;
  send: ReturnType<typeof mock>;
} {
  const root = window.document.createElement('div') as unknown as HTMLElement;
  (window.document.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
  const send = mock((_msg: FrontendToBackend) => {});
  const panel = mountModulesPanel({
    root,
    sendToBackend: send,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
  });
  return { root, panel, send };
}

function openPresets(root: HTMLElement): void {
  const btn = Array.from(root.querySelectorAll('.lr-subtab'))
    .find((b) => (b as HTMLElement).textContent === 'Presets') as unknown as HTMLButtonElement;
  btn.click();
}

function sentTypes(send: ReturnType<typeof mock>): string[] {
  return (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.map((c) => c[0]!.type);
}

function sentMessages(send: ReturnType<typeof mock>): FrontendToBackend[] {
  return (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.map((c) => c[0]!);
}

function ssTrigger(root: HTMLElement): HTMLButtonElement {
  return root.querySelector('.lrm-preset-connection') as unknown as HTMLButtonElement;
}

function ssPick(window: Window, triggerId: string, value: string): void {
  const panel = window.document.getElementById(triggerId) as unknown as HTMLElement;
  const opt = panel.querySelector(`.lr-ss-option[data-value="${value}"]`) as unknown as HTMLElement;
  opt.click();
}

describe('preset label translation controls', () => {
  test('opening the Presets subtab asks for the connection list', () => {
    const { root, send } = build();
    expect(sentTypes(send)).not.toContain('request_connections_list');
    openPresets(root);
    const types = sentTypes(send);
    expect(types).toContain('request_connections_list');
    expect(types.filter((t) => t === 'request_connections_list')).toHaveLength(1);
  });

  test('no profile means the opt-in checkbox stays disabled', () => {
    const { root, send } = build();
    openPresets(root);
    const checkbox = window.document.getElementById('lr-preset-translate-labels') as unknown as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(sentMessages(send).some((m) => m.type === 'import_card_from_upload')).toBe(false);
  });

  test('the profile list enables the opt-in and gates the select on it', () => {
    const { root, panel } = build();
    openPresets(root);
    panel.handleBackendMessage({
      type: 'connections_list_pushed',
      connections: CONNECTIONS,
    } as BackendToFrontend);

    const checkbox = window.document.getElementById('lr-preset-translate-labels') as unknown as HTMLInputElement;
    const trigger = ssTrigger(root);
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(false);
    // The default profile is pre-selected so an opt-in always names a target.
    expect(trigger.textContent).toContain('Lumi Main');
    expect(trigger.hasAttribute('disabled')).toBe(true);

    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change') as unknown as Event);
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
});

describe('preset import carries the translation opt-in', () => {
  async function importPreset(root: HTMLElement, send: ReturnType<typeof mock>, translate: boolean): Promise<FrontendToBackend> {
    openPresets(root);
    const checkbox = window.document.getElementById('lr-preset-translate-labels') as unknown as HTMLInputElement;
    const trigger = ssTrigger(root);
    if (translate) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change') as unknown as Event);
      trigger.click();
      ssPick(window, trigger.getAttribute('aria-controls')!, 'conn-2');
    }
    const uploadBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Upload preset (.risup)…') as unknown as HTMLButtonElement;
    uploadBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    const upload = uploads[uploads.length - 1]!;
    expect(upload.started).toBe(true);
    (upload as unknown as { url: string }).url = '/api/v1/spindle-uploads/upload-1';
    upload.options.onSuccess!();
    return sentMessages(send).filter((m) => m.type === 'import_card_from_upload').pop()!;
  }

  test('sends no translation request when the opt-in is off', async () => {
    const { root, send } = build();
    const msg = await importPreset(root, send, false);
    expect(msg.type).toBe('import_card_from_upload');
    expect('presetLabelTranslation' in msg).toBe(false);
  });

  test('sends the picked connection profile when the opt-in is on', async () => {
    const { root, send, panel } = build();
    openPresets(root);
    panel.handleBackendMessage({
      type: 'connections_list_pushed',
      connections: CONNECTIONS,
    } as BackendToFrontend);
    const msg = await importPreset(root, send, true);
    expect(msg).toMatchObject({
      type: 'import_card_from_upload',
      uploadId: 'upload-1',
      fileName: 'synthetic.risup',
      presetLabelTranslation: { connectionId: 'conn-2' },
    });
  });

  test('keeps the picked profile when the host pushes the list again', async () => {
    const { root, send, panel } = build();
    openPresets(root);
    panel.handleBackendMessage({
      type: 'connections_list_pushed',
      connections: CONNECTIONS,
    } as BackendToFrontend);
    await importPreset(root, send, true);
    panel.handleBackendMessage({
      type: 'connections_list_pushed',
      connections: CONNECTIONS,
    } as BackendToFrontend);
    expect(ssTrigger(root).textContent).toContain('Cheap Local');
  });
});
