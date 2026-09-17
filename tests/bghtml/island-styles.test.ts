import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { setupIslandStyles, rescopeRisuEnvironment } from '../../src/bghtml/island-styles.js';
import { setupBgHtmlRenderer } from '../../src/bghtml/render.js';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

let win: Window;
let manager: ReturnType<typeof setupIslandStyles>;
const saved = new Map<string, PropertyDescriptor | undefined>();

// Happy DOM weakly holds mutation callbacks; retain them for the fixture lifetime.
class FixtureWeakRef<T extends object> {
  constructor(private readonly value: T) {}
  deref(): T { return this.value; }
}

beforeEach(() => {
  win = new Window();
  for (const key of ['document', 'Element', 'MutationObserver', 'CSSStyleSheet', 'WeakRef'] as const) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: key === 'WeakRef' ? FixtureWeakRef : win[key], configurable: true, writable: true });
  }
  manager = setupIslandStyles();
});

afterEach(async () => {
  manager.destroy();
  await win.happyDOM.close();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function island(inMessage = true) {
  const parent = document.createElement('div');
  if (inMessage) parent.setAttribute('data-message-id', 'message');
  const host = document.createElement('div');
  host.setAttribute('data-lumiverse-html-island', '');
  parent.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style data-lumi-island-base>h1{font-size:1.35em}</style><h1>Menu</h1>';
  document.body.append(parent);
  return { parent, host, root, base: root.firstElementChild! };
}

describe('native island compatibility styles', () => {
  test('shares only rendered styles and withdraws them when their source disappears', async () => {
    const source = island();
    const target = island();
    source.root.innerHTML += '<style>.panel{opacity:0;animation:reveal 2s 26.5s forwards}</style>';
    manager.setActiveChat('chat');
    const sheet = target.root.adoptedStyleSheets[1]!;
    expect(sheet?.cssRules[0]!.cssText).toContain('opacity: 0');
    source.root.innerHTML = '<p>Another screen</p>';
    await win.happyDOM.waitUntilComplete();
    expect(target.root.adoptedStyleSheets.includes(sheet)).toBe(false);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });

  test('updates styles within a retained shadow and keeps their document order', async () => {
    const first = island();
    const last = island();
    first.root.innerHTML += '<style>.panel{color:red}</style>';
    last.root.innerHTML += '<style>.panel{color:blue}</style>';
    manager.setActiveChat('chat');
    const colors = () => first.root.adoptedStyleSheets.slice(1).map(s => s.cssRules[0]!.cssText);
    expect(colors()).toEqual(['.panel { color: red; }', '.panel { color: blue; }']);
    last.root.querySelector('style')!.textContent = '.panel{color:green}';
    await win.happyDOM.waitUntilComplete();
    expect(colors().at(-1)).toBe('.panel { color: green; }');
    document.body.prepend(last.parent);
    await win.happyDOM.waitUntilComplete();
    expect(colors()).toEqual(['.panel { color: green; }', '.panel { color: red; }']);
    last.parent.remove();
    await win.happyDOM.waitUntilComplete();
    expect(colors()).toEqual(['.panel { color: red; }']);
  });

  test('shares light DOM styles with islands without replacing sheets for unrelated text changes', async () => {
    const foreign = new CSSStyleSheet();
    document.adoptedStyleSheets = [foreign];
    const target = island();
    const source = document.createElement('style');
    source.textContent = '.panel{position:relative}';
    source.media = '(min-width: 1px)';
    target.parent.prepend(source);
    manager.setActiveChat('chat');
    const sheet = target.root.adoptedStyleSheets[1]!;
    const scoped = document.adoptedStyleSheets[1];
    expect(sheet?.cssRules[0]!.cssText).toContain('@media');
    target.root.querySelector('h1')!.textContent = 'Streaming text';
    document.body.append(document.createElement('p'));
    await win.happyDOM.waitUntilComplete();
    expect(target.root.adoptedStyleSheets[1]).toBe(sheet);
    expect(document.adoptedStyleSheets).toEqual([foreign, scoped!]);
    source.textContent = '.panel{position:absolute}';
    await win.happyDOM.waitUntilComplete();
    expect(target.root.adoptedStyleSheets[1]!.cssRules[0]!.cssText).toContain('position: absolute');
    manager.destroy();
    expect(document.adoptedStyleSheets).toEqual([foreign]);
  });

  test('activates only for a Risu chat and only in native message islands', () => {
    const owned = island();
    const outside = island(false);
    const foreign = new CSSStyleSheet();
    owned.root.adoptedStyleSheets = [foreign];
    expect(owned.root.adoptedStyleSheets).toHaveLength(1);
    manager.setActiveChat('chat');
    expect(owned.root.adoptedStyleSheets).toHaveLength(2);
    expect(owned.root.adoptedStyleSheets[0]).toBe(foreign);
    expect(owned.root.querySelector('[data-lumi-island-base]')).toBeNull();
    expect(outside.root.adoptedStyleSheets).toHaveLength(0);
    expect(outside.root.firstElementChild).toBe(outside.base);
    expect(document.head.textContent).toBe('');
  });

  test('shares updated card styles and survives native innerHTML replacement', async () => {
    manager.setActiveChat('chat');
    manager.setStylesheets(['.panel{position:absolute}']);
    const a = island();
    const b = island();
    await win.happyDOM.waitUntilComplete();
    const sheet = a.root.adoptedStyleSheets[1]!;
    expect(b.root.adoptedStyleSheets[1]).toBe(sheet);
    expect(sheet.cssRules[0]!.cssText).toContain('position: absolute');
    a.root.innerHTML = '<button risu-trigger="choose">Choose</button>';
    manager.setStylesheets(['.panel{position:relative}']);
    expect(a.root.adoptedStyleSheets[1]!.cssRules[0]!.cssText).toContain('position: relative');
    expect(a.host.classList.contains('not-island-prose')).toBe(true);
    expect(a.root.querySelector('[risu-trigger]')?.textContent).toBe('Choose');
    const rule = a.root.adoptedStyleSheets[1]!.cssRules[0];
    manager.setStylesheets(['.panel{position:relative}']);
    expect(a.root.adoptedStyleSheets[1]!.cssRules[0]).toBe(rule);
  });

  test('clears old card CSS on chat switch and restores native styling on exit', () => {
    const a = island();
    const foreign = new CSSStyleSheet();
    a.root.adoptedStyleSheets = [foreign];
    manager.setActiveChat('first');
    manager.setStylesheets(['.first{color:red}']);
    const sheet = a.root.adoptedStyleSheets[2]!;
    manager.setActiveChat('second');
    expect(a.root.adoptedStyleSheets.includes(sheet)).toBe(false);
    expect(a.root.adoptedStyleSheets).toHaveLength(2);
    manager.setActiveChat(null);
    expect(a.root.adoptedStyleSheets).toEqual([foreign]);
    expect(a.root.firstElementChild).toBe(a.base);
    expect(a.host.classList.contains('not-island-prose')).toBe(false);
    manager.setActiveChat('first');
    manager.setStylesheets(['.first{color:red}']);
    expect(a.root.adoptedStyleSheets[2]!.cssRules).toHaveLength(1);
  });

  test('releases removed roots and preserves author opt-outs on teardown', async () => {
    const a = island();
    a.host.classList.add('not-island-prose');
    a.base.remove();
    manager.setActiveChat('chat');
    a.parent.remove();
    await win.happyDOM.waitUntilComplete();
    expect(a.root.adoptedStyleSheets).toHaveLength(0);
    expect(a.host.classList.contains('not-island-prose')).toBe(true);
    expect(a.root.querySelector('[data-lumi-island-base]')).toBeNull();
    manager.destroy();
    const b = island();
    await win.happyDOM.waitUntilComplete();
    expect(b.root.adoptedStyleSheets).toHaveLength(0);
  });

  test('does not retain islands mounted and removed in one observer batch', async () => {
    manager.setActiveChat('chat');
    const a = island();
    a.parent.remove();
    await win.happyDOM.waitUntilComplete();
    expect(a.root.adoptedStyleSheets).toHaveLength(0);
    expect(a.root.firstElementChild).toBe(a.base);
  });

  test('keeps separate rule stylesheets independently parseable', () => {
    const a = island();
    manager.setActiveChat('chat');
    manager.setStylesheets(['.broken { color:', '.panel{position:absolute}']);
    expect(a.root.adoptedStyleSheets).toHaveLength(3);
    expect(a.root.adoptedStyleSheets[2]!.cssRules[0]!.cssText).toContain('position: absolute');
    manager.setStylesheets(['.panel{position:relative}']);
    expect(a.root.adoptedStyleSheets).toHaveLength(2);
    expect(a.root.adoptedStyleSheets[1]!.cssRules[0]!.cssText).toContain('position: relative');
  });

  test('uses the Risu chat shell metrics without adding a light DOM wrapper', () => {
    const css = rescopeRisuEnvironment('.prose h1{font-size:2.25em}.chattext p{color:red}');
    expect(css).toContain(':host h1{font-size:2.25em}');
    expect(css).toContain('font-size:calc(14px * var(--lumiverse-font-scale,1))');
    expect(css).toContain('line-height:calc(20px * var(--lumiverse-font-scale,1))');
    expect(css).not.toContain('.chattext');
    const a = island();
    manager.setActiveChat('chat');
    manager.setActiveChat(null);
    expect(a.parent.children).toHaveLength(1);
    expect(a.parent.firstElementChild).toBe(a.host);
    expect(a.host.children).toHaveLength(0);
  });

  test('background renderer delivers shared CSS and clears it for empty backgrounds', () => {
    const noop = () => {};
    const ctx = { dom: { createElement(tag: string, attrs: Record<string, string>) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      return el;
    } } } as unknown as SpindleFrontendContext;
    const renderer = setupBgHtmlRenderer(ctx, { info: noop, debug: noop, trace: noop, warn: noop, error: noop });
    try {
      const a = island();
      renderer.setActiveChat('chat');
      renderer.handleMessage({ type: 'render_bg_html', chatId: 'chat',
        bgHtml: '<style>.panel{position:relative}</style>' });
      const sheet = a.root.adoptedStyleSheets[1]!;
      expect(Array.from(sheet.cssRules, r => r.cssText).join('\n')).toContain(':host .panel');
      renderer.handleMessage({ type: 'clear_bg_html', chatId: 'chat' });
      expect(a.root.adoptedStyleSheets.includes(sheet)).toBe(false);
      expect(a.root.adoptedStyleSheets).toHaveLength(1);
      renderer.setActiveChat(null);
      expect(a.root.adoptedStyleSheets).toHaveLength(0);
      expect(a.root.firstElementChild).toBe(a.base);
      renderer.handleMessage({ type: 'render_bg_html', chatId: 'background',
        bgHtml: '<style>.panel{position:absolute}</style>' });
      expect(a.root.adoptedStyleSheets).toHaveLength(0);
      expect(a.root.firstElementChild).toBe(a.base);
    } finally {
      renderer.destroy();
    }
  });
});
