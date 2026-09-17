import environmentCss from './risu-environment.css' with { type: 'text' };
import { stripCssImports } from './strip-imports.js';

const ISLAND_SELECTOR = '[data-lumiverse-html-island]';
const BASE_SELECTOR = 'style[data-lumi-island-base]';
const OPT_OUT = 'not-island-prose';

function changesStyle(record: MutationRecord): boolean {
  if ((record.target instanceof Element ? record.target : record.target.parentElement)?.closest('style')) return true;
  return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
    && (node.matches('style') || node.querySelector('style') !== null));
}

// The retained native islands have no Risu chat-shell ancestors. Keep this
// compatibility environment inside their shadows, away from themed prose.
export function rescopeRisuEnvironment(css: string): string {
  return css
    .replace(/\.prose-invert\b/g, ':host')
    .replace(/\.prose\b(?!-)/g, ':host')
    .replace(/\.chattext\b/g, ':host')
    .replace(/\.chat-width\b/g, ':host')
    .replace(/:root\b(?!,)/g, ':root,:host')
    .replace(/--FontColorQuote2:\s*(#[0-9a-fA-F]{3,8})/g,
      '--FontColorQuote2:var(--lumiverse-prose-dialogue,$1)')
    // Risu's Chat.svelte sets these inline; host font scale substitutes for Risu zoom.
    + '\n:host{font-size:calc(14px * var(--lumiverse-font-scale,1));'
    + 'line-height:calc(20px * var(--lumiverse-font-scale,1));overflow:visible !important}\n';
}

export function setupIslandStyles() {
  let chatId: string | null = null;
  let environment: CSSStyleSheet | null = null;
  let shared: CSSStyleSheet[] = [];
  let lastCss: readonly string[] = [];
  let backgroundCss: readonly string[] = [];
  let messageCss: readonly string[] = [];
  let messageSheets: CSSStyleSheet[] = [];
  const scopedSheets = new WeakMap<CSSStyleSheet, CSSStyleSheet>();
  let syncPending = false;
  const roots = new Map<ShadowRoot, { base: Element | null; addedOptOut: boolean; observer: MutationObserver }>();

  function scheduleSync(): void {
    if (syncPending) return;
    syncPending = true;
    queueMicrotask(() => { syncPending = false; syncMessageStyles(); });
  }

  // Risu ParseMarkdown emits CSS from rendered output. Unmatched replacements
  // must never contribute styles, including animations for other card screens.
  function syncMessageStyles(): void {
    if (!chatId) return;
    const sources: { anchor: Element; style: HTMLStyleElement }[] = [];
    for (const style of document.querySelectorAll<HTMLStyleElement>('[data-message-id] style')) {
      sources.push({ anchor: style, style });
    }
    for (const root of roots.keys()) {
      if (!root.host.isConnected) continue;
      for (const style of root.querySelectorAll<HTMLStyleElement>(`style:not([data-lumi-island-base])`)) {
        sources.push({ anchor: root.host, style });
      }
    }
    sources.sort((a, b) => a.anchor === b.anchor ? 0
      : a.anchor.compareDocumentPosition(b.anchor) & 4 ? -1 : 1);
    const parts = sources.map(({ style }) => {
      const css = stripCssImports(style.textContent ?? '');
      return style.media ? `@media ${style.media}{${css}}` : css;
    }).filter(css => css.trim().length > 0);
    if (parts.length === messageCss.length && parts.every((css, i) => css === messageCss[i])) return;
    messageCss = parts;
    applyStylesheets();
    const previous = new Set(messageSheets);
    messageSheets = shared.slice(backgroundCss.length).map(sheet => {
      let scoped = scopedSheets.get(sheet);
      if (!scoped) {
        const css = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
        scoped = new CSSStyleSheet();
        scoped.replaceSync(`[data-message-id] [data-component="MessageContent"] {\n${css}\n}`);
        scopedSheets.set(sheet, scoped);
      }
      return scoped;
    });
    document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter(s => !previous.has(s)), ...messageSheets];
  }

  function release(root: ShadowRoot): void {
    const state = roots.get(root)!;
    state.observer.disconnect();
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(s => s !== environment && !shared.includes(s));
    if (state.addedOptOut) root.host.classList.remove(OPT_OUT);
    if (state.base && !root.querySelector(BASE_SELECTOR)
      && !root.host.matches('.not-prose,.not-island-prose')
      && !root.querySelector('.not-prose,.not-island-prose')) {
      root.prepend(state.base);
    }
    roots.delete(root);
  }

  function adopt(host: Element): boolean {
    const root = host.shadowRoot;
    if (!root || roots.has(root) || !host.isConnected || !host.closest('[data-message-id]')) return false;
    const base = root.querySelector(BASE_SELECTOR);
    const addedOptOut = !host.classList.contains(OPT_OUT);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, environment!, ...shared];
    const observer = new MutationObserver(records => { if (records.some(changesStyle)) scheduleSync(); });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['media'] });
    roots.set(root, { base, addedOptOut, observer });
    host.classList.add(OPT_OUT);
    base?.remove();
    return true;
  }

  function scan(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    let changed = false;
    const hosts = [...node.querySelectorAll(ISLAND_SELECTOR)];
    if (node.matches(ISLAND_SELECTOR)) hosts.unshift(node);
    for (const host of hosts) {
      if (adopt(host) || (host.shadowRoot && roots.has(host.shadowRoot))) changed = true;
    }
    return changed;
  }

  const observer = new MutationObserver(records => {
    let changed = false;
    for (const root of roots.keys()) {
      if (!root.host.isConnected || !root.host.closest('[data-message-id]')) { release(root); changed = true; }
    }
    for (const record of records) {
      for (const node of record.addedNodes) changed = scan(node) || changed;
    }
    if (changed || records.some(changesStyle)) scheduleSync();
  });

  function applyStylesheets(): void {
    const parts = [...backgroundCss, ...messageCss];
    if (parts.length === lastCss.length && parts.every((css, i) => css === lastCss[i])) return;
    const previous = new Set(shared);
    const cached = new Map(lastCss.map((css, i) => [css, shared[i]!]));
    // Preserve stylesheet boundaries: malformed CSS in one rule must not
    // consume the next rule's declarations.
    shared = parts.map(css => {
      const existing = cached.get(css);
      if (existing) return existing;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      cached.set(css, sheet);
      return sheet;
    });
    lastCss = [...parts];
    for (const root of roots.keys()) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets.filter(s => !previous.has(s)), ...shared];
    }
  }

  function setStylesheets(parts: readonly string[]): void {
    backgroundCss = parts;
    applyStylesheets();
  }

  function setActiveChat(next: string | null): void {
    if (next === chatId) return;
    observer.disconnect();
    for (const root of roots.keys()) release(root);
    messageCss = [];
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => !messageSheets.includes(s));
    messageSheets = [];
    setStylesheets([]);
    chatId = next;
    if (!next) return;
    if (!environment) {
      environment = new CSSStyleSheet();
      environment.replaceSync(rescopeRisuEnvironment(environmentCss));
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['media'] });
    scan(document.body);
    syncMessageStyles();
  }

  return {
    setActiveChat,
    setStylesheets,
    destroy: () => setActiveChat(null),
  };
}
