// Port of Risu's bg-HTML rewrite pipeline (DOMPurify hook + decodeStyleRule).
// Divergences: universal selectors (body/html/:root/*) rewrite to :host instead
// of leaking into chrome (opt-in via rewriteUniversalToHost, default true). On
// CSS parse error, emit the block verbatim. Pure string tokenizer, no DOM.

const CLASS_PREFIX = "x-risu-";

// Skip hljs* and x-risu-* in HTML classes (Risu parity).
function shouldSkipHtmlClassToken(tok: string): boolean {
  return tok.startsWith("hljs") || tok.startsWith(CLASS_PREFIX);
}

// CSS skips only x-risu-*. hljs-* gets prefixed (Risu parity).
function shouldSkipCssClassName(name: string): boolean {
  return name.startsWith(CLASS_PREFIX);
}


export function rewriteClassValue(value: string): string {
  if (!value) return value;
  return value
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => (shouldSkipHtmlClassToken(t) ? t : CLASS_PREFIX + t))
    .join(" ");
}

export function rewriteHtmlClasses(html: string): string {
  return html.replace(
    /\bclass\s*=\s*(["'])([\s\S]*?)\1/g,
    (_match, quote: string, value: string) =>
      `class=${quote}${rewriteClassValue(value)}${quote}`,
  );
}

// Symmetric to unprefixCssClassSelectors, atomic per-attribute. The
// quote-balanced regex skips fragmented class attrs across rule boundaries,
// CBS-resolved tokens stay because they don't literal-start with `x-risu-`.
function unprefixHtmlClassValue(value: string): string {
  if (!value) return value;
  const PREFIX = "x-risu-";
  return value
    .split(/(\s+)/)
    .map((seg) => (seg.startsWith(PREFIX) ? seg.slice(PREFIX.length) : seg))
    .join("");
}

export function unprefixHtmlClasses(html: string): string {
  if (!html || html.length === 0) return html;
  return html.replace(
    /\bclass\s*=\s*(["'])([\s\S]*?)\1/g,
    (_match, quote: string, value: string) =>
      `class=${quote}${unprefixHtmlClassValue(value)}${quote}`,
  );
}

// Risu's DOMPurify normalizes incomplete entities like `&nbsp` (no semi).
// Lumi's marked-first pipeline rejects them and escapes the `&`.
const HTML_ENTITY_NORMALIZE_RE = /&(nbsp|amp|lt|gt|quot|apos|copy|reg|trade)(?![\w;])/g;

export function normalizeIncompleteHtmlEntities(text: string): string {
  if (!text || text.length === 0) return text;
  return text.replace(HTML_ENTITY_NORMALIZE_RE, "&$1;");
}

export interface CssRewriteOpts {
  /** Ancestor scope prepended to every rewritten selector (Risu uses `.chattext `). */
  readonly scopePrefix?: string;
  /** Rewrite bare body/html/:root/* to :host. Default true (avoids full-page rules leaking into chrome). */
  readonly rewriteUniversalToHost?: boolean;
  readonly hostSelector?: string;
  /** Replace @import url(data:*) with data:, Default true. */
  readonly killDataImports?: boolean;
  readonly rewriteClassNames?: boolean;
  // Strip leading `x-risu-` from class selectors so author-prefixed rules
  // match unprefixed HTML (Lumirealm doesn't apply Risu's render-time prefix).
  readonly unprefixClassNames?: boolean;
}

export function unprefixCssClassSelectors(css: string): string {
  if (!css || css.length === 0) return css;
  try {
    return rewriteCss(css, {
      rewriteClassNames: false,
      unprefixClassNames: true,
      rewriteUniversalToHost: false,
      scopePrefix: "",
      killDataImports: true,
    });
  } catch {
    return css;
  }
}

// Atomic per <style> block, safe for use over fragmented HTML.
const STYLE_BLOCK_TAGGED_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
export function unprefixCssInStyleBlocks(html: string): string {
  if (!html || html.indexOf("<style") < 0) return html;
  return html.replace(
    STYLE_BLOCK_TAGGED_RE,
    (_full, open: string, css: string, close: string) =>
      open + unprefixCssClassSelectors(css) + close,
  );
}

const DEFAULT_OPTS: Required<CssRewriteOpts> = {
  scopePrefix: ".chattext ",
  rewriteUniversalToHost: true,
  hostSelector: ":host",
  killDataImports: true,
  rewriteClassNames: true,
  unprefixClassNames: false,
};

export function rewriteCss(css: string, opts: CssRewriteOpts = {}): string {
  const o: Required<CssRewriteOpts> = { ...DEFAULT_OPTS, ...opts };
  const parser = new CssParser(css);
  const nodes = parser.parseBlock(/* topLevel */ true);
  return serializeNodes(nodes, o, /* inKeyframes */ false);
}


interface StyleRule {
  readonly kind: "style";
  readonly selectorList: string;
  readonly declarations: string;
}

interface AtRule {
  readonly kind: "at";
  readonly name: string;
  readonly prelude: string;
  readonly block: Node[] | null;
}

interface Raw {
  readonly kind: "raw";
  readonly text: string;
}

type Node = StyleRule | AtRule | Raw;

const NESTING_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "document",
  "-moz-document",
  "host",
  "layer",
  "scope",
]);

// Declaration-like bodies; no selector rewrites inside.
const DECLARATION_AT_RULES = new Set([
  "font-face",
  "page",
  "property",
  "counter-style",
  "viewport",
  "-ms-viewport",
]);

const KEYFRAMES_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "-moz-keyframes", "-o-keyframes"]);

class CssParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  /** Parse until EOF (topLevel=true) or matching `}` (nested). */
  parseBlock(topLevel: boolean): Node[] {
    const out: Node[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === undefined) break;
      if (isWs(ch)) {
        const start = this.pos;
        while (this.pos < this.src.length && isWs(this.src[this.pos]!)) this.pos++;
        out.push({ kind: "raw", text: this.src.slice(start, this.pos) });
        continue;
      }
      if (ch === "/" && this.src[this.pos + 1] === "*") {
        out.push({ kind: "raw", text: this.readComment() });
        continue;
      }
      if (!topLevel && ch === "}") {
        this.pos++; // consume the closing brace; caller captured the block
        return out;
      }
      if (ch === "@") {
        out.push(this.parseAtRule());
        continue;
      }
      out.push(this.parseStyleRule());
    }
    return out;
  }

  private readComment(): string {
    const start = this.pos;
    this.pos += 2; // skip /*
    while (this.pos < this.src.length) {
      if (this.src[this.pos] === "*" && this.src[this.pos + 1] === "/") {
        this.pos += 2;
        return this.src.slice(start, this.pos);
      }
      this.pos++;
    }
    return this.src.slice(start, this.pos); // unterminated; return rest as raw
  }

  private parseAtRule(): AtRule {
    // Consume `@` then name
    this.pos++; // @
    const nameStart = this.pos;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (isWs(c) || c === "{" || c === ";" || c === "(") break;
      this.pos++;
    }
    const name = this.src.slice(nameStart, this.pos);
    // Read prelude until `{` or `;`, respecting string + paren nesting.
    const preludeStart = this.pos;
    this.skipUntilBlockOrSemi();
    const prelude = this.src.slice(preludeStart, this.pos);
    const next = this.src[this.pos];
    if (next === ";") {
      this.pos++;
      return { kind: "at", name, prelude, block: null };
    }
    if (next === "{") {
      this.pos++; // consume {
      const lname = name.toLowerCase();
      if (DECLARATION_AT_RULES.has(lname)) {
        const bodyStart = this.pos;
        this.skipMatchingBrace();
        const bodyText = this.src.slice(bodyStart, this.pos);
        if (this.src[this.pos] === "}") this.pos++;
        return {
          kind: "at",
          name,
          prelude,
          block: [{ kind: "raw", text: bodyText }],
        };
      }
      const block = this.parseBlock(/* topLevel */ false);
      return { kind: "at", name, prelude, block };
    }
    return { kind: "at", name, prelude, block: null }; // EOF; treat as bodyless
  }

  private parseStyleRule(): StyleRule {
    const selStart = this.pos;
    this.skipUntilBlockOrSemi();
    const endCh = this.src[this.pos];
    if (endCh !== "{") {
      // Malformed: emit as empty rule, browser ignores.
      const text = this.src.slice(selStart, this.pos);
      if (this.src[this.pos] === ";") this.pos++;
      return { kind: "style", selectorList: text, declarations: "" };
    }
    const selectorList = this.src.slice(selStart, this.pos);
    this.pos++; // consume {
    const bodyStart = this.pos;
    this.skipMatchingBrace();
    const body = this.src.slice(bodyStart, this.pos);
    if (this.src[this.pos] === "}") this.pos++;
    return { kind: "style", selectorList, declarations: body };
  }

  private skipUntilBlockOrSemi(): void {
    let parens = 0;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"' || c === "'") {
        this.skipString(c);
        continue;
      }
      if (c === "/" && this.src[this.pos + 1] === "*") {
        this.readComment();
        continue;
      }
      if (c === "(") {
        parens++;
        this.pos++;
        continue;
      }
      if (c === ")") {
        if (parens > 0) parens--;
        this.pos++;
        continue;
      }
      if (parens === 0 && (c === "{" || c === ";")) return;
      this.pos++;
    }
  }

  private skipMatchingBrace(): void {
    let depth = 1;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"' || c === "'") {
        this.skipString(c);
        continue;
      }
      if (c === "/" && this.src[this.pos + 1] === "*") {
        this.readComment();
        continue;
      }
      if (c === "{") {
        depth++;
        this.pos++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) return;
        this.pos++;
        continue;
      }
      this.pos++;
    }
  }

  private skipString(quote: string): void {
    this.pos++; // consume opening quote
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === "\\") {
        this.pos += 2;
        continue;
      }
      if (c === quote) {
        this.pos++;
        return;
      }
      if (c === "\n") return; // malformed string, stop to avoid runaway
      this.pos++;
    }
  }
}

function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
}


function serializeNodes(nodes: Node[], opts: Required<CssRewriteOpts>, inKeyframes: boolean): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "raw") {
      out += n.text;
    } else if (n.kind === "at") {
      out += serializeAtRule(n, opts, inKeyframes);
    } else {
      out += serializeStyleRule(n, opts, inKeyframes);
    }
  }
  return out;
}

function serializeAtRule(at: AtRule, opts: Required<CssRewriteOpts>, parentIsKeyframes: boolean): string {
  const name = at.name.toLowerCase();

  // Stub data: imports (Risu parity).
  if (name === "import" && opts.killDataImports) {
    const prelude = at.prelude;
    if (/\burl\(\s*['"]?data:/i.test(prelude) || /^\s*['"]?data:/i.test(prelude)) {
      return `@import url('data:,');`;
    }
  }

  const preludeStr = at.prelude;
  if (at.block === null) {
    return `@${at.name}${preludeStr};`;
  }

  if (NESTING_AT_RULES.has(name)) {
    const inner = serializeNodes(at.block, opts, parentIsKeyframes);
    return `@${at.name}${preludeStr}{${inner}}`;
  }

  if (KEYFRAMES_AT_RULES.has(name)) {
    const inner = serializeNodes(at.block, opts, /* inKeyframes */ true);
    return `@${at.name}${preludeStr}{${inner}}`;
  }

  if (DECLARATION_AT_RULES.has(name)) {
    const inner = serializeNodes(at.block, opts, parentIsKeyframes);
    return `@${at.name}${preludeStr}{${inner}}`;
  }

  // Unknown at-rule with a block, recurse conservatively.
  const inner = serializeNodes(at.block, opts, parentIsKeyframes);
  return `@${at.name}${preludeStr}{${inner}}`;
}

function serializeStyleRule(rule: StyleRule, opts: Required<CssRewriteOpts>, inKeyframes: boolean): string {
  if (inKeyframes) {
    // Keyframe selectors pass through.
    return `${rule.selectorList}{${rule.declarations}}`;
  }
  const rewritten = rewriteSelectorList(rule.selectorList, opts);
  return `${rewritten}{${rule.declarations}}`;
}


// Outer-level comma split. Preserves parens/brackets/strings.
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let inStr: string | null = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "(") { parens++; continue; }
    if (c === ")") { if (parens > 0) parens--; continue; }
    if (c === "[") { brackets++; continue; }
    if (c === "]") { if (brackets > 0) brackets--; continue; }
    if (c === "," && parens === 0 && brackets === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

function rewriteSelector(selector: string, opts: Required<CssRewriteOpts>): string {
  const leadMatch = /^\s*/.exec(selector)!;
  const tailMatch = /\s*$/.exec(selector)!;
  const lead = leadMatch[0];
  const tail = tailMatch[0];
  let core = selector.slice(lead.length, selector.length - tail.length);

  if (core.length === 0) return selector;

  if (opts.rewriteClassNames) {
    core = core.replace(
      /(?<![\\])\.(-?[_a-zA-Z][\w-]*)/g,
      (_m, name: string) => {
        if (shouldSkipCssClassName(name)) {
          return `.${name}`;
        }
        return `.${CLASS_PREFIX}${name}`;
      },
    );
  } else if (opts.unprefixClassNames) {
    core = core.replace(
      /(?<![\\])\.x-risu-(-?[_a-zA-Z][\w-]*)/g,
      (_m, name: string) => `.${name}`,
    );
  }

  const rewrittenUniversal = opts.rewriteUniversalToHost ? rewriteUniversalLead(core, opts.hostSelector) : null;
  if (rewrittenUniversal !== null) return lead + rewrittenUniversal + tail;

  // :host is already the shadow root anchor, don't add scope prefix.
  const startsAtHost = /^:host(\b|[^a-zA-Z_-])/.test(core);
  if (opts.scopePrefix && !startsAtHost) {
    core = opts.scopePrefix + core;
  }

  return lead + core + tail;
}

function rewriteUniversalLead(selector: string, hostSelector: string): string | null {
  const match = /^(body|html|:root|\*)(?=$|\s|[>+~,{.:\[#])/.exec(selector);
  return match ? hostSelector + selector.slice(match[1]!.length) : null;
}

function rewriteSelectorList(list: string, opts: Required<CssRewriteOpts>): string {
  return splitSelectorList(list)
    .map((s) => rewriteSelector(s, opts))
    .join(",");
}


export interface BgBundle {
  /** Rewritten CSS. Stable across state ticks; only needs to mount once. */
  readonly css: string;
  /** HTML with style blocks stripped and class= rewritten. Changes per state tick. */
  readonly html: string;
}

const STYLE_BLOCK_RE = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi;

export function splitAndRewriteBgBundle(bgHtml: string, opts: CssRewriteOpts = {}): BgBundle {
  const styles: string[] = [];
  const htmlWithoutStyles = bgHtml.replace(STYLE_BLOCK_RE, (_match, body: string) => {
    styles.push(body);
    return ""; // drop inline. <style> emitted by the mount instead.
  });
  const combinedCss = styles.join("\n");
  const rewrittenCss = combinedCss.length > 0 ? rewriteCss(combinedCss, opts) : "";
  const rewrittenHtml = rewriteHtmlClasses(htmlWithoutStyles);
  return { css: rewrittenCss, html: rewrittenHtml };
}
