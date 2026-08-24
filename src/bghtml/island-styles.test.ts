import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setupIslandStyles } from './island-styles.js';
import type { IslandStyles } from './island-styles.js';
import { setupBgHtmlRenderer } from './render.js';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;

beforeEach(() => {
  const win = new Window({ url: 'https://example.test/' });
  const values: Record<string, unknown> = {
    window: win,
    document: win.document,
    CSSStyleSheet: win.CSSStyleSheet,
    MutationObserver: win.MutationObserver,
    Element: win.Element,
    Node: win.Node,
    NodeFilter: win.NodeFilter,
    ShadowRoot: win.ShadowRoot,
  };
  for (const [name, value] of Object.entries(values)) {
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

function makeLog(): {
  error(): void;
  warn(): void;
  info(): void;
  debug(): void;
  trace(): void;
} {
  return {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
  };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('Firefox host-state mirror', () => {
  test('includes the roundedImage host-state suppression rule in generated island CSS', () => {
    const styles: string[] = [];
    const islandStyles: IslandStyles = {
      setStylesheet: (css) => styles.push(css),
      setCrossRuleSheets: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    };
    const ctx = {
      dom: {
        createElement(tag: string, attrs: Record<string, string>): HTMLElement {
          const element = document.createElement(tag);
          for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
          return element;
        },
      },
    } as unknown as SpindleFrontendContext;
    const renderer = setupBgHtmlRenderer(ctx, makeLog(), islandStyles);

    renderer.handleMessage({
      type: 'render_bg_html',
      chatId: 'chat-1',
      bgHtml: '<style>.roundedImage { transition: transform 1s; }</style><div></div>',
    });

    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain(':host([data-lumi-scrolling]) .roundedImage');
    renderer.destroy();
  });

  test('mirrors and clears scrolling from the nearest chat scroll container', async () => {
    const outerScroll = document.createElement('div');
    outerScroll.setAttribute('data-chat-scroll', 'true');
    outerScroll.setAttribute('data-scrolling', '');
    const nearestScroll = document.createElement('div');
    nearestScroll.setAttribute('data-chat-scroll', 'true');
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'message-1');
    const host = document.createElement('div');
    message.append(host);
    nearestScroll.append(message);
    outerScroll.append(nearestScroll);
    document.body.append(outerScroll);
    const shadow = host.attachShadow({ mode: 'open' });

    const islandStyles = setupIslandStyles(makeLog());
    expect(shadow.adoptedStyleSheets).toHaveLength(1);
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(false);

    nearestScroll.setAttribute('data-scrolling', '');
    await flushMutations();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(true);

    nearestScroll.removeAttribute('data-scrolling');
    await flushMutations();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(false);

    nearestScroll.setAttribute('data-scrolling', '');
    await flushMutations();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(true);

    const outside = document.createElement('div');
    outside.setAttribute('data-chat-scroll', 'true');
    outside.setAttribute('data-scrolling', '');
    document.body.append(outside);
    outside.append(host);
    await flushMutations();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(false);

    message.append(host);
    await flushMutations();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(true);
    islandStyles.destroy();
    expect(host.hasAttribute('data-lumi-scrolling')).toBe(false);
  });
});
