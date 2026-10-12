/**
 * Normalize a macro name per Risu's `matcher()` rule. // Risu parser.svelte.ts
 * Strips `[-_ ]` and lowercases. Byte scan, no regex.
 */
export function normalizeMacroName(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x20 /* space */ || c === 0x5f /* _ */ || c === 0x2d /* - */) continue;
    // ASCII-only fold; macro names in practice are ASCII.
    if (c >= 0x41 && c <= 0x5a) out += String.fromCharCode(c + 32);
    else out += raw[i];
  }
  return out;
}

