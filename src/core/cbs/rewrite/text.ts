import type { CatalogIndex } from "../catalog/loader.js";

// Cards store raw Risu CBS verbatim, matching RisuAI. The in-worker evaluator
// (a port of risuChatParser) resolves it at render/prompt time, so no
// translate-time prefixing, block flattening, or PUA encoding happens here.
export function rewriteText(text: string, _catalog: CatalogIndex): string {
  return text;
}

export function rewriteTextMany(
  texts: readonly string[],
  _catalog: CatalogIndex,
): readonly string[] {
  return texts;
}
