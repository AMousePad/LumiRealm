import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type {
  SpindleFrontendContext,
  SpindleModalHandle,
  SpindleModalOptions,
} from 'lumiverse-spindle-types';
import { setupRealmModal } from './frontend.js';
import type { RealmCard, RealmFrontendToBackend } from './messages.js';

const CARD: RealmCard = {
  id: 'realm-card-1',
  name: 'Realm Card',
  desc: 'A test card',
  img: '',
  tags: [],
  download: 1,
  hot: 0,
  hasLore: false,
  hasEmotion: false,
  hasAsset: false,
  type: 'character',
  viewScreen: 'none',
  license: '',
};

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;

beforeEach(() => {
  const win = new Window({ url: 'https://example.test/' });
  for (const [name, value] of Object.entries({ window: win, document: win.document })) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  browser = win;
});

afterEach(() => {
  browser?.close();
  browser = null;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
});

function makeHarness(): {
  ctx: SpindleFrontendContext;
  sent: RealmFrontendToBackend[];
  modalRoot: HTMLElement;
  dismissCount: () => number;
} {
  const sent: RealmFrontendToBackend[] = [];
  const modalRoot = document.createElement('div');
  let dismissCount = 0;
  let dismissed = false;
  const dismissListeners = new Set<() => void>();
  const modal: SpindleModalHandle = {
    root: modalRoot,
    modalId: 'realm-modal',
    dismiss(): void {
      if (dismissed) return;
      dismissed = true;
      dismissCount += 1;
      for (const listener of dismissListeners) listener();
    },
    setTitle(): void {},
    onDismiss(listener): () => void {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
  };
  const ctx = {
    dom: { addStyle: () => () => undefined },
    ui: {
      showModal(_options: SpindleModalOptions): SpindleModalHandle {
        return modal;
      },
    },
  } as unknown as SpindleFrontendContext;
  return { ctx, sent, modalRoot, dismissCount: () => dismissCount };
}

describe('RisuRealm import browsing session', () => {
  test('keeps the current browser session open while importing and after download starts', () => {
    const h = makeHarness();
    const importStarts: string[] = [];
    const mountTarget = document.createElement('div');
    const realm = setupRealmModal({
      ctx: h.ctx,
      mountTarget,
      sendToBackend: (msg) => h.sent.push(msg),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      onImportStart: (label) => importStarts.push(label),
    });

    realm.open();
    const search = h.sent[0];
    expect(search?.type).toBe('realm_search');
    if (!search || search.type !== 'realm_search') throw new Error('realm search was not sent');
    realm.handleBackendMessage({
      type: 'realm_search_result',
      requestId: search.requestId,
      ok: true,
      cards: [CARD],
    });

    (h.modalRoot.querySelector('.lr-realm-card') as HTMLButtonElement).click();
    (document.querySelector('.lr-realm-popup .lr-realm-primary') as HTMLButtonElement).click();

    const download = h.sent.at(-1);
    expect(download?.type).toBe('realm_download');
    expect(importStarts).toEqual(['Realm Card']);
    expect(realm.isOpen()).toBe(true);
    expect(h.dismissCount()).toBe(0);
    if (!download || download.type !== 'realm_download') throw new Error('realm download was not sent');

    realm.handleBackendMessage({
      type: 'realm_download_started',
      requestId: download.requestId,
      ok: true,
      id: CARD.id,
    });

    expect(realm.isOpen()).toBe(true);
    expect(h.dismissCount()).toBe(0);
    expect(h.modalRoot.textContent).toContain('Realm Card');
    realm.destroy();
  });
});
