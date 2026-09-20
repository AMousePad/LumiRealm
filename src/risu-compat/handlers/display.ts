import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";

// Display / markup macros. Risu registers these as `callback: 'doc_only'` (cbs.ts+).
// At prompt time they return ''. A future renderer extension handles display-time output.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Display", scoped: false });
}

// cbs.ts. Return PUA chars so the parser doesn't re-lex them as syntax.
register("decbo", () => "\uE9B8",
  "Displays as { without being re-lexed by the parser (PUA sentinel).");
register("decbc", () => "\uE9B9",
  "Displays as } without being re-lexed.");
register("bo", () => "\uE9B8\uE9B8",
  "Displays as {{ without being re-lexed.");
register("bc", () => "\uE9B9\uE9B9",
  "Displays as }} without being re-lexed.");
register("displayescapedbracketopen", () => "\uE9BA",
  "Displays as ( (PUA sentinel).");
register("displayescapedbracketclose", () => "\uE9BB",
  "Displays as ).");
register("displayescapedanglebracketopen", () => "\uE9BC",
  "Displays as < (PUA sentinel).");
register("displayescapedanglebracketclose", () => "\uE9BD",
  "Displays as >.");
register("displayescapedcolon", () => "\uE9BE",
  "Displays as : without being parsed as a CBS separator.");
register("displayescapedsemicolon", () => "\uE9BF",
  "Displays as ;.");

// Risu repeats the raw payload, including alias spelling, when a count is supplied.
register("cbr", (_c, a, raw) => {
  if (a.length === 0) return "\\n";
  const n = Math.max(1, Number(a[0] ?? "1"));
  return raw.repeat(n);
}, "Returns a literal '\\n' without args; with a count, repeats the raw macro payload.");

// Asset family (img/image/asset/bg/emotion/video/audio/bgm/source/path/raw) and inlay* are in handlers/assets.ts.
//
// `position` is the {{position::NAME}} macro substituted by Risu's positionParser
// (index.svelte.ts:575-584). It joins content from active lorebook entries
// decorated with `@@position pt_<NAME>`. Backend populates `ctx.positionPt`
// from the worldInfoInterceptor pass; we look up by NAME (the part after pt_)
// and return the joined content. Empty string when no entries declare pt_<NAME>.
register("position", (ctx, args, raw) => {
  // `position` is not a Risu CBS function. Risu substitutes it later in
  // positionParser, so a standalone cbs() parse must leave it untouched.
  if (ctx.cbsContext) {
    const source = raw || `position::${args.join("::")}`;
    return `{{${source}}}`;
  }
  const name = args[0];
  if (typeof name !== "string" || name.length === 0) return "";
  const map = ctx.positionPt;
  if (!map) return "";
  return map[name] ?? "";
}, "Risu {{position::NAME}}: joined content of active entries with @@position pt_<NAME>.");

const DOC_ONLY: Array<[string, string]> = [
  ["slot", "{{slot::VAR}} inside a scoped block. Resolved by #each/#func/call handlers."],
];
for (const [name, desc] of DOC_ONLY) {
  register(name, () => "", desc);
}

// The scanner owns the output-buffer rewind; these leaf handlers are the
// registry fallback for direct handler calls.
register("bkspc", () => "",
  "Removes the last word from the parser output buffer.");
register("erase", () => "",
  "Removes the last sentence from the parser output buffer.");
