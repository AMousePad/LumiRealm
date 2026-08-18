import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setup } from './frontend.js';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;
let teardown: (() => void) | null = null;

function installBrowser(): Window {
  const win = new Window({ url: 'https://example.test/' });
  const values: Record<string, unknown> = {
    window: win,
    document: win.document,
    localStorage: win.localStorage,
    CSSStyleSheet: win.CSSStyleSheet,
    MutationObserver: win.MutationObserver,
  };
  for (const [name, value] of Object.entries(values)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  browser = win;
  return win;
}

function makeContext(win: Window, withDisplay = true): {
  ctx: SpindleFrontendContext;
  events: string[];
} {
  const events: string[] = [];
  const display = {
    registerResolver(): () => void {
      events.push('register');
      return () => events.push('unregister');
    },
    invalidate(): void {},
    setExpression(): void {},
  };
  const ctx = {
    deferReady(): void { events.push('defer'); },
    ready(): void { events.push('ready'); },
    ...(withDisplay ? { display } : {}),
    sendToBackend(payload: unknown): void {
      events.push(`send:${(payload as { type: string }).type}`);
    },
    onBackendMessage(): () => void {
      events.push('subscribe');
      return () => events.push('unsubscribe');
    },
    chats: {
      updateMessage(): Promise<unknown> { return Promise.resolve(); },
    },
    dom: {
      addStyle(css: string): () => void {
        const style = win.document.createElement('style');
        style.textContent = css;
        win.document.head.appendChild(style);
        return () => style.remove();
      },
    },
    ui: {
      registerDrawerTab(): { root: unknown; activate(): void; destroy(): void } {
        const root = win.document.createElement('div');
        win.document.body.appendChild(root);
        return { root, activate(): void {}, destroy(): void { root.remove(); } };
      },
    },
  } as unknown as SpindleFrontendContext;
  return { ctx, events };
}

afterEach(() => {
  teardown?.();
  teardown = null;
  browser?.close();
  browser = null;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
});

describe('frontend runtime setup', () => {
  test('registers before subscribing, handshaking, and becoming ready', () => {
    const harness = makeContext(installBrowser());
    teardown = setup(harness.ctx);

    expect(harness.events.filter((event) =>
      event === 'defer' || event === 'register' || event === 'subscribe' || event === 'ready',
    )).toEqual(['defer', 'register', 'subscribe', 'ready']);
    expect(harness.events.slice(
      harness.events.indexOf('subscribe') + 1,
      harness.events.indexOf('ready'),
    )).toEqual(['send:get_cards', 'send:log_request_state', 'send:screen_dims']);

    teardown();
    teardown = null;
    expect(harness.events.filter((event) => event === 'unregister' || event === 'unsubscribe'))
      .toEqual(['unregister', 'unsubscribe']);
  });

  test('fails before registration or readiness when display is unavailable', () => {
    const harness = makeContext(installBrowser(), false);

    expect(() => setup(harness.ctx)).toThrow(
      'LumiRealm requires the current Lumiverse display resolver API',
    );
    expect(harness.events).toEqual(['defer']);
  });
});
