import { STYLE_WRAP_OPEN } from "../../util/sanitizer-doc-shape.js";

export const ISLAND_TRIGGER_PREFIX = `<style data-risu-island-trigger></style>`;
const ISLAND_MERGE_OPEN = `<div data-risu-island-merge style="display:contents">`;
const WRAP_TRAILING_CLOSE_RE = /<\/div\s*>\s*$/i;

// Migration inverse of the retired per-rule island wrapping. Unrecognized
// shapes return unchanged so user-edited rows are never corrupted.
export function stripLegacyIslandWrappers(replaceString: string): string {
  let out = replaceString;
  if (out.startsWith(STYLE_WRAP_OPEN)) {
    const body = out.slice(STYLE_WRAP_OPEN.length);
    const tail = WRAP_TRAILING_CLOSE_RE.exec(body);
    if (!tail) return replaceString;
    out = body.slice(0, tail.index);
  }
  if (out.startsWith(ISLAND_TRIGGER_PREFIX)) {
    out = out.slice(ISLAND_TRIGGER_PREFIX.length);
  }
  if (out.startsWith(ISLAND_MERGE_OPEN)) {
    const body = out.slice(ISLAND_MERGE_OPEN.length);
    const tail = WRAP_TRAILING_CLOSE_RE.exec(body);
    if (tail) out = body.slice(0, tail.index);
  }
  return out;
}
