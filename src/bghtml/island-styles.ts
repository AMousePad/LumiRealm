// Lumi shadow-wraps styled HTML; doc-level CSS doesn't pierce shadow boundaries.
// Adopt a constructed CSSStyleSheet into each chat-message shadow via MutationObserver.
// replaceSync propagates live to all adopters with one sheet shared by reference.

import { setupQuoteMarks, type QuoteMarks } from './quote-marks.js';

interface Flog {
  error(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  debug(msg: string, ...rest: unknown[]): void;
  trace(msg: string, ...rest: unknown[]): void;
}

export interface IslandStyles {
  setStylesheet(css: string): void;
  setCrossRuleSheets(cssParts: readonly string[]): void;
  clear(): void;
  destroy(): void;
}

export interface SetupIslandStylesOptions {
  readonly riskuEnvironmentCss?: string;
}

export function setupIslandStyles(flog: Flog, opts: SetupIslandStylesOptions = {}): IslandStyles {
  let sheet: CSSStyleSheet | null = null;
  let envSheet: CSSStyleSheet | null = null;
  const allOwnedSheets = new WeakSet<CSSStyleSheet>();
  try {
    sheet = new CSSStyleSheet();
    allOwnedSheets.add(sheet);
  } catch (err) {
    flog.error('island-styles: CSSStyleSheet constructor unavailable (browser predates 2023)', err);
    return {
      setStylesheet: () => { /* no-op */ },
      setCrossRuleSheets: () => { /* no-op */ },
      clear: () => { /* no-op */ },
      destroy: () => { /* no-op */ },
    };
  }

  const quoteMarks: QuoteMarks = setupQuoteMarks(flog);

  let crossRuleSheets: CSSStyleSheet[] = [];
  // Last-applied snapshots so we can short-circuit no-op refreshes. Mortal
  // Realm fires bg-html refresh 3x on chat-open (SETTINGS_UPDATED + CHAT_CHANGED
  // + …) with byte-identical content; without this gate each re-applies
  // chat-scope CSS + nudges 35 live shadow-roots × 11 sheets = ~385
  // adoption operations on the no-op pass alone.
  let lastSheetCss: string | null = null;
  let lastCrossRuleKey: string | null = null;

  if (opts.riskuEnvironmentCss && opts.riskuEnvironmentCss.length > 0) {
    try {
      const rescoped = rescopeRisuEnvironment(opts.riskuEnvironmentCss);
      envSheet = new CSSStyleSheet();
      allOwnedSheets.add(envSheet);
      envSheet.replaceSync(rescoped.css);
      flog.info(
        `island-styles: Risu environment sheet built ${opts.riskuEnvironmentCss.length}->${rescoped.css.length} bytes, ` +
          `${envSheet.cssRules.length} top-level rules ` +
          `(rewrites: :root=${rescoped.rootHits} .prose=${rescoped.proseHits} ` +
          `.prose-invert=${rescoped.proseInvertHits} .chattext=${rescoped.chattextHits} ` +
          `.chat-width=${rescoped.chatWidthHits})`,
      );
    } catch (err) {
      flog.error(
        'island-styles: Risu environment sheet construction failed (falling back to per-card sheet only)',
        err,
      );
      envSheet = null;
    }
  }

  // WeakSet for adopt-once dedup, WeakRef array for iteration + GC pruning.
  const adopted = new WeakSet<ShadowRoot>();
  const adoptedRefs: WeakRef<ShadowRoot>[] = [];

  // outsideChatShadowCount surging indicates Lumi started shadow-wrapping
  // non-chat surfaces (extractHtmlIslands drift).
  let adoptionCount = 0;
  let chatShadowCount = 0;
  let outsideChatShadowCount = 0;
  const ADOPT_LOG_STRIDE = 50;

  function injectInto(shadow: ShadowRoot): void {
    if (adopted.has(shadow)) return;
    if (!sheet) return;
    try {
      const append: CSSStyleSheet[] = [];
      if (envSheet) append.push(envSheet);
      if (sheet) append.push(sheet);
      for (const s of crossRuleSheets) append.push(s);
      const next = [...shadow.adoptedStyleSheets, ...append];
      shadow.adoptedStyleSheets = next;
      adopted.add(shadow);
      adoptedRefs.push(new WeakRef(shadow));

      // Lumi's ISLAND_BASE_CSS applies a different prose baseline that conflicts.
      if (shadow.host instanceof Element) {
        shadow.host.classList.add('not-island-prose');
      }
      const initialBase = shadow.querySelector('style[data-lumi-island-base]');
      if (initialBase) initialBase.remove();

      // Risu-card gate: only mark quotes when per-card CSS is loaded (non-Risu
      // chats leave perCardSheet empty, so the walker stays out of vanilla DOM).
      if (sheet.cssRules.length > 0) {
        quoteMarks.walkShadow(shadow);
        quoteMarks.watchShadow(shadow);
      }

      adoptionCount++;
      if (adoptionCount <= 8) {
        const host = shadow.host;
        const hostTag = host instanceof Element ? host.tagName.toLowerCase() : '?';
        const hostClass = host instanceof Element ? host.className : '';
        const childCount = shadow.childElementCount;
        const sheetRules = sheet.cssRules.length;
        const envRules = envSheet ? envSheet.cssRules.length : 0;
        flog.debug(
          `island-styles: adopted #${adoptionCount} into <${hostTag} class="${hostClass}"> ` +
            `(shadow has ${childCount} top-level children; envSheet ${envRules} rules + perCardSheet ${sheetRules} rules)`,
        );
      } else if (adoptionCount % ADOPT_LOG_STRIDE === 0) {
        flog.info(
          `island-styles: adopted=${adoptionCount} (chat shadows visited=${chatShadowCount}, outside-chat shadows visited=${outsideChatShadowCount})`,
        );
      }
    } catch (err) {
      flog.warn('island-styles: adoptedStyleSheets append failed', err);
    }
  }

  function visit(el: Element): void {
    // Only inject into open shadows inside [data-message-id] chat bubbles.
    const root = el.shadowRoot;
    if (!root || root.mode !== 'open') return;
    if (el.closest('[data-message-id]')) {
      chatShadowCount++;
      injectInto(root);
    } else {
      outsideChatShadowCount++;
    }
  }

  function walkSubtree(root: Node): void {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (root instanceof Element) visit(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let cur: Node | null = walker.nextNode();
    while (cur) {
      if (cur instanceof Element) {
        visit(cur);
        if (cur.shadowRoot && cur.shadowRoot.mode === 'open') {
          walkSubtree(cur.shadowRoot);
        }
      }
      cur = walker.nextNode();
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof Element) walkSubtree(node);
      }
    }
  });

  // TODO: tighten to a stable chat container if MutationObserver shows up in profiling.
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (err) {
    flog.error('island-styles: observer.observe failed', err);
  }

  // Scan shadows that already exist at setup time (page refresh on active chat).
  try {
    walkSubtree(document.body);
  } catch (err) {
    flog.warn('island-styles: initial walk failed', err);
  }

  flog.info('island-styles: setup complete (adopting into Lumi message-island shadows)');

  function nudgeAdopters(reason: string): void {
    if (adoptedRefs.length === 0) return;
    let nudged = 0;
    let dead = 0;
    for (let i = adoptedRefs.length - 1; i >= 0; i--) {
      const shadow = adoptedRefs[i]!.deref();
      if (!shadow) {
        adoptedRefs.splice(i, 1);
        dead++;
        continue;
      }
      try {
        // adoptedStyleSheets is a live proxy, snapshot via Array.from.
        const current = Array.from(shadow.adoptedStyleSheets);
        shadow.adoptedStyleSheets = [];
        shadow.adoptedStyleSheets = current;
        nudged++;
      } catch {
        /* */
      }
    }
    if (nudged > 0 || dead > 0) {
      flog.info(
        `island-styles: nudged adopters reason=${reason} ` +
          `nudged=${nudged} dead_refs_pruned=${dead} live=${adoptedRefs.length}`,
      );
    }
  }

  function reAdoptAll(): void {
    for (let i = adoptedRefs.length - 1; i >= 0; i--) {
      const shadow = adoptedRefs[i]!.deref();
      if (!shadow) {
        adoptedRefs.splice(i, 1);
        continue;
      }
      try {
        const append: CSSStyleSheet[] = [];
        if (envSheet) append.push(envSheet);
        if (sheet) append.push(sheet);
        for (const s of crossRuleSheets) append.push(s);
        const existing = Array.from(shadow.adoptedStyleSheets);
        const filtered = existing.filter((s) => !allOwnedSheets.has(s));
        shadow.adoptedStyleSheets = [...filtered, ...append];
      } catch (err) {
        flog.warn('island-styles: re-adopt failed', err);
      }
    }
  }

  return {
    setStylesheet(css: string): void {
      if (!sheet) return;
      // Skip the work when content is byte-identical to the last apply.
      // bg-html refresh fires multiple times on chat-open with identical
      // payload; without this gate every refresh re-parses + re-adopts into
      // every live shadow root.
      if (lastSheetCss !== null && lastSheetCss === css) {
        flog.info(`island-styles: setStylesheet skipped — content unchanged (${css.length} bytes)`);
        return;
      }
      try {
        sheet.replaceSync(css);
        lastSheetCss = css;
        nudgeAdopters('setStylesheet');
      } catch (err) {
        flog.error('island-styles: replaceSync failed', err);
      }
    },
    setCrossRuleSheets(cssParts: readonly string[]): void {
      // Same content-skip as setStylesheet. Cross-rule sheets fire
      // alongside setStylesheet on every bg-html refresh. On island-heavy
      // cards the 9-sheet bundle is ~62KB, and re-parsing byte-identical
      // input was the bulk of the chat-open lag.
      const key = cssParts.length + '\x1f' + cssParts.join('\x1e');
      if (lastCrossRuleKey === key) {
        flog.info(
          `island-styles: setCrossRuleSheets skipped — content unchanged (parts=${cssParts.length})`,
        );
        return;
      }
      const next: CSSStyleSheet[] = [];
      let okCount = 0;
      let failCount = 0;
      for (let i = 0; i < cssParts.length; i++) {
        const part = cssParts[i] ?? '';
        if (part.trim().length === 0) continue;
        try {
          const s = new CSSStyleSheet();
          allOwnedSheets.add(s);
          s.replaceSync(part);
          next.push(s);
          okCount++;
        } catch (err) {
          failCount++;
          flog.warn(
            `island-styles: cross-rule sheet ${i} parse failed (skipped): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      crossRuleSheets = next;
      lastCrossRuleKey = key;
      reAdoptAll();
      flog.info(
        `island-styles: cross-rule sheets set ok=${okCount} failed=${failCount} total_parts=${cssParts.length}`,
      );
    },
    clear(): void {
      if (!sheet) return;
      try {
        sheet.replaceSync('');
        lastSheetCss = null;
        lastCrossRuleKey = null;
        nudgeAdopters('clear');
      } catch { /* */ }
    },
    destroy(): void {
      try { observer.disconnect(); } catch { /* */ }
      if (sheet) {
        try { sheet.replaceSync(''); } catch { /* */ }
      }
      sheet = null;
      envSheet = null;
    },
  };
}

// Risu CSS assumes a chat-shell ancestor (.chattext/.prose/.prose-invert/.chat-width).
// Those ancestors don't exist inside the extractHtmlIslands shadow, so rewrite
// them to :host. Rewrite order matters: .prose-invert before .prose. Also rewrites
// :root to :root,:host (CSS vars absent inside shadow). Appends a :host baseline
// mirroring chat-shell default font/line-height.

interface RescopeResult {
  readonly css: string;
  readonly rootHits: number;
  readonly proseHits: number;
  readonly proseInvertHits: number;
  readonly chattextHits: number;
  readonly chatWidthHits: number;
}

export function rescopeRisuEnvironment(input: string): RescopeResult {
  let css = input;
  // .prose-invert must run before .prose rewrite
  const proseInvertHits = (css.match(/\.prose-invert\b/g) ?? []).length;
  css = css.replaceAll(/\.prose-invert\b/g, ':host');
  const proseHits = (css.match(/\.prose\b(?!-)/g) ?? []).length;
  css = css.replaceAll(/\.prose\b(?!-)/g, ':host');
  const chattextHits = (css.match(/\.chattext\b/g) ?? []).length;
  css = css.replaceAll(/\.chattext\b/g, ':host');
  const chatWidthHits = (css.match(/\.chat-width\b/g) ?? []).length;
  css = css.replaceAll(/\.chat-width\b/g, ':host');
  // (?!,) skips already-paired :root,:host (Tailwind v4 @theme output)
  const rootHits = (css.match(/:root\b(?!,)/g) ?? []).length;
  css = css.replaceAll(/:root\b(?!,)/g, ':root,:host');
  // overflow:visible !important defeats Lumi's `_htmlIsland_*` host
  // `overflow: hidden` (set from outside the shadow at equal specificity, so
  // :host loses without !important). Font-size / line-height are intentionally
  // not set here, so Lumi's --lumiverse-font-scale inheritance reaches card content.
  css +=
    '\n:host{overflow:visible !important}\n';

  return {
    css,
    rootHits,
    proseHits,
    proseInvertHits,
    chattextHits,
    chatWidthHits,
  };
}
