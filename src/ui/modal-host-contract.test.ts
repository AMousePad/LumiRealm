import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type {
  SpindleFrontendContext,
  SpindleModalHandle,
  SpindleModalOptions,
} from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import { setupAlertModal } from './alert-modal.js';
import type { FrontendLog } from './drawer.js';
import { setupHostVersionModal } from './host-version-modal.js';
import { setupLegacyReimportModal } from './legacy-reimport-modal.js';
import { setupPermissionsModal } from './permissions-modal.js';
import { setupPickModal } from './pick-modal.js';

interface ModalController {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

type ModalSetup = (opts: {
  ctx: SpindleFrontendContext;
  sendToBackend: (msg: FrontendToBackend) => void;
  log: FrontendLog;
}) => ModalController;

let originalDocument: Document | undefined;

beforeEach(() => {
  const window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

function makeLog(errors: unknown[][] = []): FrontendLog {
  return {
    error: (...args) => { errors.push(args); },
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
  };
}

function makeHost(throws = false): {
  ctx: SpindleFrontendContext;
  options: SpindleModalOptions[];
  handles: SpindleModalHandle[];
} {
  const options: SpindleModalOptions[] = [];
  const handles: SpindleModalHandle[] = [];
  const ctx = {
    ui: {
      showModal(input: SpindleModalOptions): SpindleModalHandle {
        options.push(input);
        if (throws) throw new Error('modal unavailable');
        const listeners = new Set<() => void>();
        let dismissed = false;
        const handle: SpindleModalHandle = {
          root: document.createElement('div'),
          modalId: `modal-${handles.length}`,
          dismiss: () => {
            if (dismissed) return;
            dismissed = true;
            for (const listener of listeners) listener();
          },
          setTitle: () => undefined,
          onDismiss: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  } as unknown as SpindleFrontendContext;
  return { ctx, options, handles };
}

const cases: readonly {
  setup: ModalSetup;
  message: BackendToFrontend;
  expected: SpindleModalOptions;
}[] = [
  {
    setup: setupAlertModal,
    message: { type: 'request_alert', requestId: 'alert-1', message: 'Alert' },
    expected: { title: '', width: 380 },
  },
  {
    setup: setupPickModal,
    message: { type: 'request_pick', requestId: 'pick-1', title: 'Pick', options: ['A'] },
    expected: { title: 'Pick', width: 420 },
  },
  {
    setup: setupPermissionsModal,
    message: { type: 'notify_missing_permissions', missing: ['images'], purposes: { images: 'Assets' } },
    expected: { title: 'LumiRealm: missing permissions', width: 520 },
  },
  {
    setup: setupLegacyReimportModal,
    message: { type: 'notify_legacy_card_needs_reimport', characterId: 'char-1', characterName: 'Card' },
    expected: { title: 'Legacy Card Detected', width: 460 },
  },
  {
    setup: setupHostVersionModal,
    message: {
      type: 'notify_host_version_outdated',
      hostVersion: '1.0.0',
      minimum: '1.1.5',
      message: 'Update',
    },
    expected: { title: 'Update Lumiverse', width: 460 },
  },
];

describe('modal host contract', () => {
  test('uses the current showModal handle without changing modal content', async () => {
    for (const item of cases) {
      const host = makeHost();
      const controller = item.setup({ ctx: host.ctx, sendToBackend: () => undefined, log: makeLog() });
      controller.handleBackendMessage(item.message);
      expect(host.options).toEqual([item.expected]);
      expect(host.handles).toHaveLength(1);
      expect(host.handles[0]!.root.childElementCount).toBeGreaterThan(0);
      controller.destroy();
    }
    await Promise.resolve();
  });

  test('preserves modal creation failure handling', () => {
    const host = makeHost(true);
    const errors: unknown[][] = [];
    const sent: FrontendToBackend[] = [];
    for (const item of cases) {
      item.setup({ ctx: host.ctx, sendToBackend: (msg) => sent.push(msg), log: makeLog(errors) })
        .handleBackendMessage(item.message);
    }
    expect(errors).toHaveLength(cases.length);
    expect(sent).toEqual([
      { type: 'alert_dismissed', requestId: 'alert-1' },
      { type: 'pick_resolved', requestId: 'pick-1', value: null },
    ]);
  });
});
