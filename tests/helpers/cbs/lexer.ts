
export type TokenKind = "text" | "open" | "close" | "legacy_open" | "legacy_close";

export interface Token {
  readonly kind: TokenKind;
  /** Source substring the token spans. `open`/`close`/`legacy_*` are always two chars. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Lex a CBS source string into tokens. */
export function lex(src: string): Token[] {
  const out: Token[] = [];
  const n = src.length;
  let i = 0;
  let textStart = 0;

  const flushText = (end: number): void => {
    if (end > textStart) {
      out.push({ kind: "text", value: src.slice(textStart, end), start: textStart, end });
    }
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 0x7b /* { */ && i + 1 < n) {
      const next = src.charCodeAt(i + 1);
      if (next === 0x7b) {
        // `{{`
        flushText(i);
        out.push({ kind: "open", value: "{{", start: i, end: i + 2 });
        i += 2;
        textStart = i;
        continue;
      }
      if (next === 0x23 /* # */) {
        // `{#`
        flushText(i);
        out.push({ kind: "legacy_open", value: "{#", start: i, end: i + 2 });
        i += 2;
        textStart = i;
        continue;
      }
    } else if (c === 0x7d /* } */ && i + 1 < n && src.charCodeAt(i + 1) === 0x7d) {
      // `}}`
      flushText(i);
      out.push({ kind: "close", value: "}}", start: i, end: i + 2 });
      i += 2;
      textStart = i;
      continue;
    } else if (c === 0x23 /* # */ && i + 1 < n && src.charCodeAt(i + 1) === 0x7d) {
      // `#}`
      flushText(i);
      out.push({ kind: "legacy_close", value: "#}", start: i, end: i + 2 });
      i += 2;
      textStart = i;
      continue;
    }
    i++;
  }
  flushText(n);
  return out;
}
