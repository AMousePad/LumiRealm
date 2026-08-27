import { ISLAND_TRIGGER_PREFIX } from '../core/mappers/island-merge.js';
import {
  STYLE_WRAP_OPEN,
  STYLE_WRAP_CLOSE,
} from '../util/sanitizer-doc-shape.js';

// Cards rely on Risu's one-parse-context-per-message model: display rules
// emit unbalanced HTML fragments that only assemble into the intended tree
// when the whole transformed message parses at once. The host renders prose
// plus per-block shadow islands instead, so the resolver wraps the entire
// resolved message in a single island to recreate that context.

// Block containers the host's island extractor treats as depth-zero wrappers.
const BLOCK_TAGS = new Set([
  'div', 'section', 'article', 'aside', 'nav', 'main', 'header', 'footer',
  'form', 'fieldset', 'figure', 'details',
]);

const RAWTEXT_TAGS = new Set(['style', 'script', 'textarea', 'title', 'xmp']);

interface BlockTagToken {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly kind: 'open' | 'close';
}

const CLOSE_NAME_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/;
const OPEN_NAME_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)/;

function nextBlockTag(text: string, from: number): BlockTagToken | null {
  let i = from;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) return null;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    const next = text.charCodeAt(lt + 1);
    if (next === 0x2f /* / */) {
      const m = CLOSE_NAME_RE.exec(text.slice(lt, lt + 40));
      if (!m) {
        i = lt + 2;
        continue;
      }
      const gt = text.indexOf('>', lt + 2);
      const end = gt < 0 ? n : gt + 1;
      const name = m[1]!.toLowerCase();
      if (BLOCK_TAGS.has(name)) return { start: lt, end, name, kind: 'close' };
      i = end;
      continue;
    }
    if (next === 0x21 /* ! */ || next === 0x3f /* ? */) {
      const gt = text.indexOf('>', lt + 1);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    const m = OPEN_NAME_RE.exec(text.slice(lt, lt + 40));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[1]!.toLowerCase();
    let j = lt + 1 + m[1]!.length;
    let quote = '';
    while (j < n) {
      const ch = text[j]!;
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    const end = j >= n ? n : j + 1;
    const selfClosing = text[j - 1] === '/';
    if (RAWTEXT_TAGS.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}\\s*>`, 'ig');
      closeRe.lastIndex = end;
      const cm = closeRe.exec(text);
      i = cm ? cm.index + cm[0].length : n;
      continue;
    }
    if (BLOCK_TAGS.has(name) && !selfClosing) {
      return { start: lt, end, name, kind: 'open' };
    }
    i = end;
  }
  return null;
}

function popThrough(stack: string[], name: string): boolean {
  const idx = stack.lastIndexOf(name);
  if (idx < 0) return false;
  stack.length = idx;
  return true;
}

// The host island matcher counts raw name depth from the wrapper's open
// tag, so unbalanced content would land the island boundary mid-message.
// Recovery semantics match the HTML parser's.
export function normalizeBlockBalance(text: string): string {
  const stack: string[] = [];
  const parts: string[] = [];
  let kept = 0;
  let pos = 0;
  let tok: BlockTagToken | null;
  while ((tok = nextBlockTag(text, pos)) !== null) {
    if (tok.kind === 'open') {
      stack.push(tok.name);
    } else if (!popThrough(stack, tok.name)) {
      parts.push(text.slice(kept, tok.start));
      kept = tok.end;
    }
    pos = tok.end;
  }
  parts.push(text.slice(kept));
  for (let i = stack.length - 1; i >= 0; i--) {
    parts.push(`</${stack[i]}>`);
  }
  return parts.join('');
}

const STYLE_TAG_RE = /<style[\s>]/i;

function hasIslandWorthyContent(text: string): boolean {
  return nextBlockTag(text, 0) !== null || STYLE_TAG_RE.test(text);
}

// Risu's chat text span carries its font metrics as an inline style
// (0.875rem size, 1.25rem line-height at default zoom), so they are absent
// from the shipped CSS bundle and must be re-applied here. Multiplying by
// the host font-scale variable makes the native Font Scale setting the
// analog of Risu's zoom.
const RISU_CHAT_METRICS_STYLE =
  'font-size:calc(0.875rem * var(--lumiverse-font-scale, 1));'
  + 'line-height:calc(1.25rem * var(--lumiverse-font-scale, 1))';

export const MESSAGE_ISLAND_OPEN =
  `${STYLE_WRAP_OPEN.slice(0, -1)} style="${RISU_CHAT_METRICS_STYLE}">`;

// Pure-markdown and inline-only messages keep the host's prose rendering.
// Block structure or styles get the Risu-parity single context.
export function wrapResolvedContentAsIsland(content: string): string {
  if (!content || !hasIslandWorthyContent(content)) return content;
  return (
    MESSAGE_ISLAND_OPEN
    + ISLAND_TRIGGER_PREFIX
    + normalizeBlockBalance(content)
    + STYLE_WRAP_CLOSE
  );
}
