// Risu wraps display quotes in <mark risu-mark="quote{1,2}"> spans (parser.svelte.ts
// renderMarkdown post-pass) so cards can theme dialogue / thought. Lumi's markdown
// renderer has no equivalent, so we wrap at the rendered-DOM layer inside the
// chat-message shadows that island-styles already adopts into.

const SKIP_TAGS = new Set([
  "STYLE",
  "SCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "SVG",
  "MATH",
  "IFRAME",
]);

const DOUBLE_QUOTE_RE = /"([^"\n]+?)"/g;
const SINGLE_QUOTE_RE = /(?<![\w$])'([^'\n]+?)'(?![\w$])/g;

const MARK_OWN_ATTR = "data-lr-risu-quote";

interface Flog {
  warn(msg: string, ...rest: unknown[]): void;
}

export interface QuoteMarks {
  walkShadow(shadow: ShadowRoot): void;
  watchShadow(shadow: ShadowRoot): void;
  destroy(): void;
}

export function setupQuoteMarks(flog: Flog): QuoteMarks {
  // One MutationObserver per shadow root, tracked via WeakRef so scroll
  // remounts don't accumulate observers forever. pruneWatches() disconnects
  // and drops entries whose shadow host left the DOM; live watchers are
  // never evicted, so no artificial count cap exists.
  interface ShadowWatch {
    shadowRef: WeakRef<ShadowRoot>;
    observer: MutationObserver;
  }
  const watches: ShadowWatch[] = [];

  function isLive(watch: ShadowWatch): boolean {
    const shadow = watch.shadowRef.deref();
    if (!shadow) return false;
    const host = shadow.host;
    return host instanceof Element && host.isConnected;
  }

  function pruneWatches(): void {
    for (let i = watches.length - 1; i >= 0; i--) {
      const watch = watches[i]!;
      if (isLive(watch)) continue;
      try { watch.observer.disconnect(); } catch { /* */ }
      watches.splice(i, 1);
    }
  }

  function shouldSkipText(textNode: Node, root: Node): boolean {
    let p: Node | null = textNode.parentNode;
    while (p && p !== root) {
      if (p instanceof Element) {
        const tag = p.tagName;
        if (SKIP_TAGS.has(tag)) return true;
        if (tag === "MARK" && p.hasAttribute(MARK_OWN_ATTR)) return true;
      }
      p = p.parentNode;
    }
    return false;
  }

  interface RangeNode {
    start: number;
    end: number;
    kind: "quote1" | "quote2";
    children: RangeNode[];
  }

  function buildRangeTree(ranges: { start: number; end: number; kind: "quote1" | "quote2" }[]): RangeNode[] {
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const roots: RangeNode[] = [];
    const stack: RangeNode[] = [];
    for (const r of ranges) {
      while (stack.length > 0 && stack[stack.length - 1]!.end <= r.start) {
        stack.pop();
      }
      const top = stack[stack.length - 1];
      if (top && r.end > top.end) continue;
      const node: RangeNode = { start: r.start, end: r.end, kind: r.kind, children: [] };
      if (top) top.children.push(node);
      else roots.push(node);
      stack.push(node);
    }
    return roots;
  }

  function renderRangeNode(text: string, node: RangeNode, doc: Document): Element {
    const mark = doc.createElement("mark");
    mark.setAttribute("risu-mark", node.kind);
    mark.setAttribute(MARK_OWN_ATTR, "");
    let cursor = node.start;
    for (const child of node.children) {
      if (cursor < child.start) mark.appendChild(doc.createTextNode(text.slice(cursor, child.start)));
      mark.appendChild(renderRangeNode(text, child, doc));
      cursor = child.end;
    }
    if (cursor < node.end) mark.appendChild(doc.createTextNode(text.slice(cursor, node.end)));
    return mark;
  }

  function transformTextNode(node: Text): void {
    const t = node.nodeValue || "";
    if (t.indexOf('"') < 0 && t.indexOf("'") < 0) return;

    const ranges: { start: number; end: number; kind: "quote1" | "quote2" }[] = [];

    DOUBLE_QUOTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DOUBLE_QUOTE_RE.exec(t)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, kind: "quote2" });
    }
    SINGLE_QUOTE_RE.lastIndex = 0;
    while ((m = SINGLE_QUOTE_RE.exec(t)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, kind: "quote1" });
    }
    if (ranges.length === 0) return;

    const tree = buildRangeTree(ranges);
    if (tree.length === 0) return;

    const doc = node.ownerDocument;
    if (!doc) return;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    for (const root of tree) {
      if (cursor < root.start) frag.appendChild(doc.createTextNode(t.slice(cursor, root.start)));
      frag.appendChild(renderRangeNode(t, root, doc));
      cursor = root.end;
    }
    if (cursor < t.length) frag.appendChild(doc.createTextNode(t.slice(cursor)));
    const parent = node.parentNode;
    if (parent) parent.replaceChild(frag, node);
  }

  function collectTextNodes(node: Node, shadow: ShadowRoot, out: Text[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!shouldSkipText(node, shadow)) out.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== 11) return;
    if (node instanceof Element) {
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return;
      if (tag === "MARK" && node.hasAttribute(MARK_OWN_ATTR)) return;
    }
    let child: Node | null = node.firstChild;
    while (child) {
      const next: Node | null = child.nextSibling;
      collectTextNodes(child, shadow, out);
      child = next;
    }
  }

  function walkSubtree(root: Node, shadow: ShadowRoot): void {
    const targets: Text[] = [];
    collectTextNodes(root, shadow, targets);
    for (const node of targets) {
      try { transformTextNode(node); } catch (err) {
        flog.warn("quote-marks: transform threw", err);
      }
    }
  }

  function walkShadow(shadow: ShadowRoot): void {
    if (!shadow) return;
    pruneWatches();
    walkSubtree(shadow, shadow);
  }

  function watchShadow(shadow: ShadowRoot): void {
    if (!shadow) return;
    pruneWatches();
    for (const watch of watches) {
      if (watch.shadowRef.deref() === shadow) return;
    }

    let scheduled = false;
    const pending = new Set<Node>();

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === "characterData") {
          if (mut.target.nodeType === Node.TEXT_NODE) pending.add(mut.target);
          continue;
        }
        for (const n of mut.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) {
            pending.add(n);
          }
        }
      }
      if (!scheduled && pending.size > 0) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          const targets = Array.from(pending);
          pending.clear();
          for (const n of targets) {
            if (!n.isConnected) continue;
            if (n.nodeType === Node.TEXT_NODE) {
              if (!shouldSkipText(n, shadow)) {
                try { transformTextNode(n as Text); } catch (err) {
                  flog.warn("quote-marks: transform threw", err);
                }
              }
            } else {
              walkSubtree(n, shadow);
            }
          }
        });
      }
    });
    try {
      observer.observe(shadow, { childList: true, subtree: true, characterData: true });
      watches.push({ shadowRef: new WeakRef(shadow), observer });
    } catch (err) {
      flog.warn("quote-marks: observe failed", err);
    }
  }

  return {
    walkShadow,
    watchShadow,
    destroy() {
      for (const watch of watches) {
        try { watch.observer.disconnect(); } catch { /* */ }
      }
      watches.length = 0;
    },
  };
}
