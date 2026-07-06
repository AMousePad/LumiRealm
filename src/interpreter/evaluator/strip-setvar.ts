// Mirror of Risu's runVar pass (runCurrentChatFunction), but strips ONLY the
// setvar family from stored message text (leaving other macros raw for our
// per-render display), so the strip itself makes each message-version run once.

import { normalizeMacroName } from "../../core/cbs/index.js";

// Exactly Risu's runVar-gated macros (cbs.ts setvar/addvar/setdefaultvar).
// deletevar/flushvar/setchatvar are NOT Risu CBS macros, they stay literal in
// message text there, so they must stay literal here too.
const SETVAR_FAMILY = new Set(
  ["setvar", "addvar", "setdefaultvar"].map(normalizeMacroName),
);

export function hasSetvarFamily(text: string): boolean {
  if (!text.includes("{{")) return false;
  return /\{\{\s*(?:setvar|addvar|setdefaultvar|set_var|add_var|set_default_var)\s*:/i.test(text);
}

function leafName(inner: string): string {
  const colon = inner.indexOf(":");
  return normalizeMacroName(colon === -1 ? inner : inner.slice(0, colon));
}

// execSpan runs the full `{{...}}` span through the evaluator (commit + persist),
// executing the mutation and returning its output ("" for the setvar family).
export function stripSetvarSpans(
  text: string,
  execSpan: (span: string) => string,
): { text: string; changed: boolean; ran: number } {
  if (!hasSetvarFamily(text)) return { text, changed: false, ran: 0 };
  let out = "";
  let ran = 0;
  let blockDepth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === "{" && text[i + 1] === "{") {
      // Match the close tracking nested {{ }} so a setvar with a nested arg macro
      // is treated as one span.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === "{" && text[j + 1] === "{") { depth += 1; j += 2; continue; }
        if (text[j] === "}" && text[j + 1] === "}") { depth -= 1; j += 2; continue; }
        j += 1;
      }
      if (depth !== 0) { out += text.slice(i); break; } // unbalanced, emit rest verbatim
      const span = text.slice(i, j);
      const inner = text.slice(i + 2, j - 2);
      const marker = inner[0];
      if (marker === "#") { blockDepth += 1; out += span; i = j; continue; }
      if (marker === "/") { blockDepth = Math.max(0, blockDepth - 1); out += span; i = j; continue; }
      // Only strip top-level setvar-family leaves. Inside a block we leave the body
      // raw (setvar in a conditional branch stays overlay-only).
      if (blockDepth === 0 && SETVAR_FAMILY.has(leafName(inner))) {
        out += execSpan(span);
        ran += 1;
      } else {
        out += span;
      }
      i = j;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return { text: out, changed: ran > 0 && out !== text, ran };
}
