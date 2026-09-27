import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setup } from '../../src/frontend.js';
import { logStore } from '../../src/log/store.js';
import { removeConsoleCapture } from '../../src/log/frontend-capture.js';

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
    navigator: win.navigator,
    location: win.location,
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
    frontendSessionId: '0123456789abcdef0123456789abcdef',
    getActiveChat: () => ({ chatId: null, characterId: null }),
    events: { on() { return () => {}; } },
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
  removeConsoleCapture();
  logStore.setState({ enabled: false });
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

test('frontend status replies do not increase the diagnostic event count', () => {
  const harness = makeContext(installBrowser());
  let receive: (message: unknown) => void = () => {};
  harness.ctx.onBackendMessage = (listener) => { receive = listener; return () => {}; };
  teardown = setup(harness.ctx);
  const state = { type: 'log_state_pushed', enabled: true, includeChatData: true, level: 'trace', eventCount: 0, bufferBytes: 0 };
  receive(state);
  const before = logStore.snapshot().events.length;
  for (let i = 0; i < 100; i++) receive(state);
  expect(logStore.snapshot().events.length).toBe(before);
  removeConsoleCapture();
  logStore.setState({ enabled: false });
});

test.each([0, 20])('log export encodes %s backend records without a combined string', async count => {
  const harness = makeContext(installBrowser());
  let receive: (message: unknown) => void = () => {};
  harness.ctx.onBackendMessage = listener => { receive = listener; return () => {}; };
  teardown = setup(harness.ctx);
  logStore.setState({ enabled: true, includeChatData: true });
  logStore.push('info', 'test', 'frontend \"quoted\"\n\ud83d\ude00\ud800');
  const events = Array.from({ length: count }, (_, ts) => ({ ts, level: 'info', category: 'test', message: 'x'.repeat(200) }));
  const stringify = JSON.stringify;
  const limit = spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
    const text = stringify(value, replacer as never, space);
    if (text.length > 2048) throw new RangeError('Invalid string length');
    return text;
  });
  let downloaded: Blob | undefined;
  const url = spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new TypeError('Expected a log Blob');
    downloaded = blob;
    return 'blob:test';
  });
  try {
    receive({ type: 'log_export_pushed', events, session: { extensionVersion: 'test', userId: null, activeChatId: null, activeCharacterId: null } });
    expect(downloaded).toBeDefined();
    const bundle = JSON.parse(await downloaded!.text());
    expect(bundle.events.backend).toEqual(events);
    expect(bundle.events.frontend.map((event: { message: string }) => event.message)).toContain('frontend \"quoted\"\n\ud83d\ude00\ud800');
    expect(bundle.schema).toBe('lumirealm-log-v1');
    expect(harness.events).toContain('send:log_set_state');
  } finally { limit.mockRestore(); url.mockRestore(); }
});

test('failed log downloads preserve capture and report the failure', () => {
  const win = installBrowser();
  const harness = makeContext(win);
  let receive: (message: unknown) => void = () => {};
  harness.ctx.onBackendMessage = listener => { receive = listener; return () => {}; };
  teardown = setup(harness.ctx);
  logStore.setState({ enabled: true, includeChatData: true });
  logStore.push('info', 'test', 'retained evidence');
  const url = spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('Blob storage unavailable'); });
  const alert = mock(() => {});
  Object.defineProperty(win, 'alert', { configurable: true, value: alert });
  try {
    receive({ type: 'log_export_pushed', events: [], session: { extensionVersion: 'test', userId: null, activeChatId: null, activeCharacterId: null } });
    expect(harness.events).not.toContain('send:log_set_state');
    expect(logStore.isEnabled()).toBe(true);
    expect(logStore.snapshot().events.some(event => event.message === 'retained evidence')).toBe(true);
    expect(alert).toHaveBeenCalledWith('Log export failed: Blob storage unavailable. The captured logs have been kept.');
  } finally { url.mockRestore(); }
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
