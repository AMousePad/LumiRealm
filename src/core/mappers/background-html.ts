import type { ScriptPackEntry, ScriptBindingEntry } from "../pipeline/types.js";
import { applyIframePolicy } from "./iframe-policy.js";
import { extractGlobalFontDeclarations, prependCssToBgHtml } from "./font-hoist.js";
import {
  SvgIndexer,
  extractAndReplaceSvgs,
  type SvgRasterTask,
} from "../svg-rasterize.js";


export interface PrepareBgHtmlOpts {
  /** `replace_string`s from the character's regex scripts, used to harvest `@font-face` declarations. */
  readonly regexReplaceStrings: readonly string[];
  /** Optional shared SvgIndexer. Import passes one to accumulate across surfaces, save omits for a fresh indexer. */
  readonly svgIndexer?: SvgIndexer;
}

export interface PreparedBgHtml {
  /** Post-translate runtime-ready HTML (fonts hoisted, SVGs marker-substituted). */
  readonly translated: string | null;
  /** All raster tasks on the indexer (caller's prior tasks + this call's). */
  readonly pendingSvgs: readonly SvgRasterTask[];
  readonly svgTemplatedSkipped: number;
  readonly svgDangerousSkipped: number;
}

/** Pre-translate card-side bg-html preserved on the envelope. */
export function extractCardSideBackgroundHtml(
  data: { readonly source?: { readonly card: unknown } },
): string | null {
  const card = data.source?.card as
    | { data?: { extensions?: { risuai?: { backgroundHTML?: unknown } } } }
    | undefined;
  const raw = card?.data?.extensions?.risuai?.backgroundHTML;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Single-source-of-truth bg-html translate pipeline shared by import + user-save. */
export function prepareBackgroundHtmlForRuntime(
  raw: string | null,
  opts: PrepareBgHtmlOpts,
): PreparedBgHtml {
  const indexer = opts.svgIndexer ?? new SvgIndexer();
  if (raw === null || raw.length === 0) {
    return {
      translated: null,
      pendingSvgs: indexer.getTasks(),
      svgTemplatedSkipped: 0,
      svgDangerousSkipped: 0,
    };
  }
  const hoistedFontCss = extractGlobalFontDeclarations(opts.regexReplaceStrings);
  let translated = hoistedFontCss
    ? (prependCssToBgHtml(raw, hoistedFontCss) ?? raw)
    : raw;
  let svgTemplatedSkipped = 0;
  let svgDangerousSkipped = 0;
  if (translated && translated.indexOf("<svg") >= 0) {
    const r = extractAndReplaceSvgs(translated, indexer);
    translated = r.rewritten;
    svgTemplatedSkipped = r.templatedSkipped;
    svgDangerousSkipped = r.dangerousSkipped;
  }
  return {
    translated,
    pendingSvgs: indexer.getTasks(),
    svgTemplatedSkipped,
    svgDangerousSkipped,
  };
}


const SHORTHAND_MARKER_START = "{";

export interface BuildBackgroundHtmlOptions {
  readonly characterId: string;
  readonly characterName?: string;
  readonly runtimeLibrary?: string;
}

export interface BuildBackgroundHtmlResult {
  readonly file: ScriptPackEntry | null;
  readonly issues: readonly { path: string; message: string }[];
}

export function buildBackgroundHtmlScript(
  html: string | null,
  opts: BuildBackgroundHtmlOptions,
): BuildBackgroundHtmlResult {
  if (typeof html !== "string" || html.length === 0) return { file: null, issues: [] };
  const issues: { path: string; message: string }[] = [];

  const expanded = expandShorthand(html);
  // Risu parity: rewrite YouTube `embed/` iframes to a click-through anchor;
  // strip all other iframes. See iframe-policy.ts. Bg-html is rendered into a
  // shadow-DOM mount that is also subject to Lumi's sanitizer + the
  // document-level CSP `frame-src 'self' blob:` (so direct YouTube iframes
  // wouldn't load anyway).
  const rewritten = applyIframePolicy(expanded).html;

  const bindings: readonly ScriptBindingEntry[] = [
    {
      type: "character",
      characterId: opts.characterId,
      displayName: opts.characterName ?? opts.characterId,
    },
  ];

  const code = renderCode({
    html: rewritten,
    characterId: opts.characterId,
    runtimeLib: opts.runtimeLibrary ?? "risu-compat",
  });

  const entry: ScriptPackEntry = {
    name: "risu-bg-html",
    code,
    type: "trigger",
    triggers: ["CHAT_CHANGED", "ls:startup"],
    bindings,
    folder: "risu/background-html",
    path: "scripts/background-html/risu-bg-html.js",
  };

  return { file: entry, issues };
}

export function expandShorthand(src: string): string {
  const n = src.length;
  const out: string[] = [];
  let i = 0;
  let runStart = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 0x7b /* { */) {
      if (i + 1 < n && src.charCodeAt(i + 1) === 0x7b) {
        i += 2;
        continue;
      }
      let j = i + 1;
      if (j >= n) break;
      const first = src.charCodeAt(j);
      if (!isIdentStart(first)) {
        i++;
        continue;
      }
      j++;
      while (j < n && isIdentCont(src.charCodeAt(j))) j++;
      if (j < n && src.charCodeAt(j) === 0x7d && j - i > 1) {
        out.push(src.slice(runStart, i));
        out.push("{{getvar::", src.slice(i + 1, j), "}}");
        i = j + 1;
        runStart = i;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  out.push(src.slice(runStart, n));
  return out.join("");
}

function isIdentStart(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
}

function isIdentCont(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

interface RenderArgs {
  readonly html: string;
  readonly characterId: string;
  readonly runtimeLib: string;
}

function renderCode(a: RenderArgs): string {
  void a.runtimeLib;
  const frontmatter = [
    `// @name       risu-bg-html`,
    `// @type       trigger`,
    `// @triggers   CHAT_CHANGED, ls:startup`,
    `// @folder     risu/background-html`,
    `// @description LumiRealm translated backgroundHTML (character ${a.characterId})`,
  ].join("\n");

  return [
    frontmatter,
    ``,
    `const HTML = ${JSON.stringify(a.html)};`,
    ``,
    `let resolved = HTML;`,
    `try {`,
    `  if (api && api.utils && api.utils.template && typeof api.utils.template.render === "function") {`,
    `    resolved = await api.utils.template.render(HTML, {}, { macrosOnly: true });`,
    `  }`,
    `} catch (e) { /* keep raw HTML on failure */ }`,
    ``,
    `try {`,
    `  if (api && api.ui && api.ui.dom && typeof api.ui.dom.setBackgroundHtml === "function") {`,
    `    await api.ui.dom.setBackgroundHtml(resolved);`,
    `  } else if (api && api.broadcast && typeof api.broadcast.emit === "function") {`,
    `    api.broadcast.emit("risu:bg-html", { html: resolved, characterId: ${JSON.stringify(a.characterId)} });`,
    `  }`,
    `} catch (e) { /* swallow — best-effort paint */ }`,
    ``,
  ].join("\n");
}
