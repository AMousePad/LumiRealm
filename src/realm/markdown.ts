const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'span', 'div',
  // Card and module descriptions lean on these for license / changelog blocks.
  'details', 'summary',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

// Bodies are CDATA, not content: unwrap would leak CSS/JS as visible text.
const DROP_TAGS = new Set([
  'style', 'script', 'noscript', 'template',
  'iframe', 'object', 'embed',
  'head', 'title', 'meta', 'link', 'base',
]);

const ALLOWED_ATTRS_PER_TAG: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
};

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(input: string): string {
  let out = input;
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  });
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${escapeHtml(code)}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return out;
}

function blockMarkdownToHtml(input: string): string {
  if (!input) return '';
  if (containsHtmlTags(input)) return input;
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    const joined = para.join('\n').trim();
    if (joined) {
      const withBreaks = joined.replace(/\n/g, '<br>');
      out.push(`<p>${inlineMarkdown(escapeHtml(withBreaks).replace(/&lt;br&gt;/g, '<br>'))}</p>`);
    }
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushPara();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading && heading[1] && heading[2] !== undefined) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) {
        buf.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${inlineMarkdown(escapeHtml(buf.join('\n').replace(/\n/g, '<br>')).replace(/&lt;br&gt;/g, '<br>'))}</blockquote>`);
      continue;
    }
    const ulMatch = /^(?:[-*+])\s+(.*)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      flushPara();
      const isOrdered = !!olMatch;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? '').trim();
        const m = isOrdered ? /^\d+\.\s+(.*)$/.exec(cur) : /^(?:[-*+])\s+(.*)$/.exec(cur);
        if (!m) break;
        items.push(`<li>${inlineMarkdown(escapeHtml(m[1] ?? ''))}</li>`);
        i += 1;
      }
      out.push(`<${isOrdered ? 'ol' : 'ul'}>${items.join('')}</${isOrdered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(line);
    i += 1;
  }
  flushPara();
  return out.join('\n');
}

function containsHtmlTags(s: string): boolean {
  return /<[a-z][a-z0-9-]*(\s|>|\/)/i.test(s);
}

function isAllowedUrl(url: string): boolean {
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
    const parsed = new URL(trimmed, 'https://example.invalid/');
    return ALLOWED_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

// Numeric rather than Node.*: the `Node` global isn't guaranteed everywhere
// this renders, but nodeType values are fixed by the DOM spec.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function sanitizeNode(input: Node, target: Node, doc: Document): void {
  const node = input as ChildNode;
  if (node.nodeType === TEXT_NODE) {
    target.appendChild(doc.createTextNode((node as Text).data));
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  const el = node as Element;
  const tagName = el.tagName.toLowerCase();
  if (DROP_TAGS.has(tagName)) return;
  if (!ALLOWED_TAGS.has(tagName)) {
    for (const child of Array.from(el.childNodes)) {
      sanitizeNode(child, target, doc);
    }
    return;
  }
  const cleanEl = doc.createElement(tagName);
  const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tagName];
  if (allowedAttrs) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name)) continue;
      if (name === 'href' || name === 'src') {
        if (!isAllowedUrl(attr.value)) continue;
      }
      cleanEl.setAttribute(name, attr.value);
    }
  }
  if (tagName === 'a') {
    cleanEl.setAttribute('rel', 'noopener noreferrer nofollow');
    cleanEl.setAttribute('target', '_blank');
  }
  if (tagName === 'img') {
    cleanEl.setAttribute('loading', 'lazy');
    cleanEl.setAttribute('referrerpolicy', 'no-referrer');
  }
  for (const child of Array.from(el.childNodes)) {
    sanitizeNode(child, cleanEl, doc);
  }
  target.appendChild(cleanEl);
}

export function renderDescription(raw: string): DocumentFragment {
  const doc = document;
  const frag = doc.createDocumentFragment();
  if (!raw) return frag;
  const html = blockMarkdownToHtml(raw);
  // Inert document rather than DOMParser: same no-script-execution guarantee,
  // one fewer global to depend on.
  const parsed = doc.implementation.createHTMLDocument('');
  parsed.body.innerHTML = `<div id="root">${html}</div>`;
  const sourceRoot = parsed.getElementById('root');
  if (!sourceRoot) {
    frag.appendChild(doc.createTextNode(raw));
    return frag;
  }
  const wrapper = doc.createElement('div');
  for (const child of Array.from(sourceRoot.childNodes)) {
    sanitizeNode(child, wrapper, doc);
  }
  for (const child of Array.from(wrapper.childNodes)) {
    frag.appendChild(child);
  }
  return frag;
}
