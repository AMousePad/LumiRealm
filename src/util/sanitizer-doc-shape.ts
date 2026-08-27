
const DOC_BOUNDARY_RE = /<!doctype|<\/?(?:html|head|body|meta|title|base|link)\b/i;
const HAS_STYLE_RE = /<style[\s>]/i;

const DOCTYPE_RE = /<!DOCTYPE[^>]*>/gi;
const HTML_TAG_RE = /<\/?html\b[^>]*>/gi;
const BODY_TAG_RE = /<\/?body\b[^>]*>/gi;
const HEAD_BLOCK_RE = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/gi;
const HEAD_ORPHAN_RE = /<\/?head\b[^>]*>/gi;
const STYLE_INNER_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const META_LINK_TITLE_BASE_RE = /<\/?(?:meta|title|base|link)\b[^>]*>/gi;
const TITLE_BLOCK_RE = /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi;
const LEADING_WS_RE = /^\s+/;

// Lumi shadow-islands depth-zero block wrappers from this set. Content that
// doesn't start with one falls to a fallback path that fires on the first
// style line, creating an island whose first element IS style. DOMPurify routes
// a leading style to head-insertion mode and drops it (CSS lost), so we wrap.
const STRATEGY1_BLOCK_TAGS_RE = /^<(?:div|section|article|aside|nav|main|header|footer|form|fieldset|figure|details)\b/i;

const STYLE_WRAP_OPEN = '<div data-lr-style-wrap class="not-island-prose">';
const STYLE_WRAP_CLOSE = '</div>';

function firstNonCommentElementIsBlockWrapper(html: string): boolean {
  let i = 0;
  const n = html.length;
  while (i < n) {
    const ch = html.charCodeAt(i);
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0c) { // whitespace
      i++;
      continue;
    }
    if (ch === 0x3c /* < */ && // HTML comment
        html.charCodeAt(i + 1) === 0x21 /* ! */ &&
        html.charCodeAt(i + 2) === 0x2d /* - */ &&
        html.charCodeAt(i + 3) === 0x2d /* - */) {
      const close = html.indexOf('-->', i + 4);
      if (close < 0) return false; // malformed, caller wraps if it has style
      i = close + 3;
      continue;
    }
    return STRATEGY1_BLOCK_TAGS_RE.test(html.slice(i));
  }
  return false;
}

export function normalizeReplaceStringForSanitizer(html: string): string {
  // Fast path: no doc-boundary tags and no <style>.
  if (!DOC_BOUNDARY_RE.test(html) && !HAS_STYLE_RE.test(html)) {
    return html;
  }

  let out = html;

  out = out.replace(DOCTYPE_RE, '');

  out = out.replace(HTML_TAG_RE, '');

  out = out.replace(BODY_TAG_RE, '');

  // Lift style blocks out of head, drop everything else inside.
  out = out.replace(HEAD_BLOCK_RE, (_match, headContent: string) => {
    const titleScrubbed = headContent.replace(TITLE_BLOCK_RE, '');
    const styles: string[] = [];
    STYLE_INNER_RE.lastIndex = 0; // global flag persists between calls
    let m: RegExpExecArray | null;
    while ((m = STYLE_INNER_RE.exec(titleScrubbed)) !== null) {
      styles.push(m[0]);
    }
    return styles.join('\n');
  });

  // Stray boundary tags from malformed / unclosed <head> blocks.
  out = out.replace(HEAD_ORPHAN_RE, '');
  out = out.replace(META_LINK_TITLE_BASE_RE, '');

  // Wrap with data-lr-style-wrap when the fragment has style but doesn't
  // start with a block element (otherwise the island leads with style and
  // DOMPurify drops it). Idempotent: already-block-led and portal-wrapped
  // fragments skip wrapping.
  out = out.replace(LEADING_WS_RE, '');
  if (HAS_STYLE_RE.test(out) && !firstNonCommentElementIsBlockWrapper(out)) {
    out = STYLE_WRAP_OPEN + out + STYLE_WRAP_CLOSE;
  }

  return out;
}
