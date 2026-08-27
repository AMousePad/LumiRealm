
const BLOCK_ELEMENT_RE =
  /^<(div|section|article|aside|nav|main|header|footer|form|fieldset|figure|details)\b/i;
const STYLE_TAG_RE = /<style[\s>]/i;
const INLINE_STYLE_ATTR_RE = /\bstyle\s*=/gi;
const NO_MERGE_ATTR_RE = /\bdata-no-island-merge\b/i;

export function countIslandingTopLevelBlocks(raw: string): number {
  if (!raw) return 0;
  if (!STYLE_TAG_RE.test(raw) && !/\bstyle\s*=/i.test(raw)) return 0;
  const lines = raw.split("\n");
  let i = 0;
  let count = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    const blockMatch = trimmed.match(BLOCK_ELEMENT_RE);
    if (blockMatch) {
      const blockLines: string[] = [];
      const tag = blockMatch[1]!.toLowerCase();
      const openRe = new RegExp(`<${tag}\\b`, "gi");
      const closeRe = new RegExp(`</${tag}\\b`, "gi");
      let depth = 0;
      while (i < lines.length) {
        const line = lines[i]!;
        blockLines.push(line);
        depth +=
          (line.match(openRe) || []).length - (line.match(closeRe) || []).length;
        i++;
        if (depth <= 0) break;
      }
      const blockContent = blockLines.join("\n");
      const openingTag = blockContent.split(">")[0] ?? "";
      if (/\bdata-no-island\b/i.test(openingTag)) {
        continue;
      }
      if (
        depth <= 0 &&
        (STYLE_TAG_RE.test(blockContent) ||
          countInlineStyles(blockContent) >= 3)
      ) {
        count++;
      }
      continue;
    }
    // Standalone <style> at top level  - Lumi's strategy 2 captures it
    // (plus following sibling HTML) as ONE island.
    if (/^\s*<style[\s>]/i.test(trimmed)) {
      count++;
      while (i < lines.length) {
        if (/<\/style\s*>/i.test(lines[i]!)) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return count;
}

function countInlineStyles(html: string): number {
  INLINE_STYLE_ATTR_RE.lastIndex = 0;
  let n = 0;
  while (INLINE_STYLE_ATTR_RE.exec(html)) {
    n++;
    if (n >= 3) return n;
  }
  return n;
}

export function wrapIslandMergeIfNeeded(html: string): string {
  if (!html || html.length === 0) return html;
  // Per-rule opt-out: card author can mark their rule's outermost
  // element with `data-no-island-merge` to bypass the wrap entirely.
  // a code change.
  if (NO_MERGE_ATTR_RE.test(html.split(">")[0] ?? "")) return html;
  // Idempotency: don't re-wrap if the translator already wrapped (e.g.
  // re-translation, or chained transforms).
  if (/^\s*<div\s+[^>]*data-risu-island-merge/i.test(html)) return html;
  const blockCount = countIslandingTopLevelBlocks(html);
  if (blockCount < 2) return html;
  return (
    `<div data-risu-island-merge style="display:contents">` +
    html +
    `</div>`
  );
}

const HTML_TAG_RE = /<[a-zA-Z][a-zA-Z0-9]*\b/;

const VOID_ELEMENTS = new Set([
  "input", "img", "br", "hr", "meta", "link", "source", "track",
  "wbr", "area", "base", "col", "embed", "param",
]);

export function extractFirstTopLevelElementFragment(raw: string): string {
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "<") {
      if (raw.startsWith("<!--", i)) {
        const end = raw.indexOf("-->", i + 4);
        if (end < 0) return "";
        i = end + 3;
        continue;
      }
      if (raw[i + 1] === "!" || raw[i + 1] === "?") {
        const end = raw.indexOf(">", i);
        if (end < 0) return "";
        i = end + 1;
        continue;
      }
      if (/[a-zA-Z]/.test(raw[i + 1] ?? "")) break;
    }
    i++;
  }
  if (i >= raw.length) return "";
  const start = i;
  const tagMatch = raw.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9]*)\b/);
  if (!tagMatch) return "";
  const tag = tagMatch[1]!.toLowerCase();
  let j = i + 1 + tagMatch[1]!.length;
  let inAttr = false;
  let attrQuote = "";
  while (j < raw.length) {
    const ch = raw[j];
    if (inAttr) {
      if (ch === attrQuote) inAttr = false;
      j++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inAttr = true;
      attrQuote = ch;
      j++;
      continue;
    }
    if (ch === ">") break;
    j++;
  }
  if (j >= raw.length) return "";
  const openEnd = j;
  if (raw[openEnd - 1] === "/" || VOID_ELEMENTS.has(tag)) {
    return raw.slice(start, openEnd + 1);
  }
  let depth = 1;
  let k = openEnd + 1;
  while (k < raw.length && depth > 0) {
    if (raw[k] === "<") {
      if (raw.startsWith("<!--", k)) {
        const e = raw.indexOf("-->", k + 4);
        if (e < 0) return raw.slice(start);
        k = e + 3;
        continue;
      }
      if (raw[k + 1] === "/") {
        const m = raw.slice(k).match(/^<\/([a-zA-Z][a-zA-Z0-9]*)\b/);
        if (m && m[1]!.toLowerCase() === tag) {
          depth--;
          let p = k + m[0].length;
          while (p < raw.length && raw[p] !== ">") p++;
          k = p + 1;
          continue;
        }
      } else if (/^<[a-zA-Z]/.test(raw.slice(k))) {
        const m = raw.slice(k).match(/^<([a-zA-Z][a-zA-Z0-9]*)\b/);
        if (m && m[1]!.toLowerCase() === tag) {
          let p = k + 1 + m[1]!.length;
          let inAt = false;
          let q = "";
          while (p < raw.length) {
            const ch = raw[p];
            if (inAt) {
              if (ch === q) inAt = false;
              p++;
              continue;
            }
            if (ch === '"' || ch === "'") {
              inAt = true;
              q = ch;
              p++;
              continue;
            }
            if (ch === ">") break;
            p++;
          }
          if (raw[p - 1] === "/" || VOID_ELEMENTS.has(m[1]!.toLowerCase())) {
            k = p + 1;
            continue;
          }
          depth++;
          k = p + 1;
          continue;
        }
      }
    }
    k++;
  }
  return raw.slice(start, k);
}

const ISLAND_TRIGGER_ATTR_RE = /\bdata-risu-island-trigger\b/i;
const ISLAND_TRIGGER_PREFIX = `<style data-risu-island-trigger></style>`;
export function wrapForIslandTriggerIfNeeded(html: string): string {
  if (!html || html.length === 0) return html;
  if (!HTML_TAG_RE.test(html)) return html;
  if (STYLE_TAG_RE.test(html)) return html;
  if (ISLAND_TRIGGER_ATTR_RE.test(html.slice(0, 200))) return html;
  if (NO_MERGE_ATTR_RE.test(html.split(">")[0] ?? "")) return html;
  const firstFrag = extractFirstTopLevelElementFragment(html);
  if (firstFrag.length > 0 && countInlineStyles(firstFrag) >= 3) return html;
  return ISLAND_TRIGGER_PREFIX + html;
}
