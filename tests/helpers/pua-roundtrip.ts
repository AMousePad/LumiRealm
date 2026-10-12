// PUA round-trip for the FE-resolved macro set.
//
// `{{user}}/{{char}}/{{charName}}/{{notChar}}/{{not_char}}` are resolved by
// Lumi's frontend `resolveDisplayMacros` against the CURRENT active persona
// per render. If we resolve them server-side in our `runPipeline` they'd be
// frozen into the render-MCP / display-preprocess caches, neither of which
// keys on personaId — so persona swap would show stale names.
//
// We hide them from the macro evaluator by replacing each occurrence with
// an opaque PUA-bracketed sentinel before resolve, and decoding the
// sentinels back to the canonical `{{name}}` form after. The lexer treats
// PUA chars as text so the body flows through unchanged.
//
// Round-trip is stateful via the returned token list. Callers MUST NOT
// reuse encoded text across resolve calls.

// Private Use Area sentinels (U+F8F0 .. U+F8F1). Lumi's macro lexer treats
// these as plain text — they don't trip the `{{` / `::` / `}}` tokeniser.
const ENCODE_OPEN = String.fromCharCode(0xF8F0);
const ENCODE_CLOSE = String.fromCharCode(0xF8F1);

const FE_MACRO_RE = /\{\{\s*(user|char|charName|notChar|not_char)\s*\}\}/g;
const DECODE_RE = new RegExp(`${ENCODE_OPEN}(\\d+)${ENCODE_CLOSE}`, "g");

export interface PuaEncoded {
  readonly text: string;
  readonly tokens: readonly string[];
}

export function puaEncodeFeMacros(text: string): PuaEncoded {
  if (!text || text.indexOf("{{") < 0) return { text, tokens: [] };
  const tokens: string[] = [];
  const out = text.replace(FE_MACRO_RE, (_match, name: string) => {
    const idx = tokens.length;
    tokens.push(name);
    return `${ENCODE_OPEN}${idx}${ENCODE_CLOSE}`;
  });
  return { text: out, tokens };
}

export function puaDecodeFeMacros(text: string, tokens: readonly string[]): string {
  if (tokens.length === 0) return text;
  if (text.indexOf(ENCODE_OPEN) < 0) return text;
  return text.replace(DECODE_RE, (_match, idxStr: string) => {
    const idx = Number(idxStr);
    const name = tokens[idx];
    if (name === undefined) return _match;
    return `{{${name}}}`;
  });
}
