import { decodeOpaqueBody } from "./encode.js";
import { RENAME_PREFIX } from "./rename.js";

// Inverse of the retired translate-time rewrite (rename.ts + blocks.ts). Restores
// raw Risu CBS from the `risu_<known>` forms we emitted, leaving any other
// `risu_*` string untouched so legitimate prefixes are never corrupted.

const STRUCTURAL_KINDS = new Set(["if", "if_pure", "when"]);
const OPAQUE_KINDS = new Set([
  "each", "func", "pure", "pure_display", "ignore", "escape", "code", "legacy",
]);

// leafNames = the catalog incompatibleNames the leaf rename produced, passed in
// so it stays in sync with what was emitted.
export interface UnrewriteOptions {
  readonly leafNames: ReadonlySet<string>;
}

// End index past the `}}` closing a `{{` opened at `open`, balancing nested
// `{{ }}` (opaque headers can contain macros).
function findLeafEnd(text: string, open: number): number {
  let depth = 0;
  let i = open;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("{{", i)) { depth++; i += 2; continue; }
    if (text.startsWith("}}", i)) { depth--; i += 2; if (depth === 0) return i; continue; }
    i++;
  }
  return -1;
}

// Split a leaf payload on top-level `::`, ignoring `::` nested inside `{{ }}`.
function splitTopLevel(payload: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  const n = payload.length;
  while (i < n) {
    if (payload.startsWith("{{", i)) { depth += 1; i += 2; continue; }
    if (payload.startsWith("}}", i)) { depth -= 1; i += 2; continue; }
    if (depth === 0 && payload.startsWith("::", i)) {
      parts.push(payload.slice(last, i));
      i += 2;
      last = i;
      continue;
    }
    i++;
  }
  parts.push(payload.slice(last));
  return parts;
}

// segments[0] is the name. The body is the last segment (PUA-encoded at emit
// time, so it has no top-level `::`), and anything between is the header.
function reconstructOpaque(kind: string, segments: string[]): string {
  const body = decodeOpaqueBody(segments[segments.length - 1] ?? "");
  const header = segments.slice(1, -1).join("::");
  if (kind === "legacy") return body;
  const open = header.length > 0 ? `{{#${kind} ${header}}}` : `{{#${kind}}}`;
  return `${open}${body}{{/${kind}}}`;
}

export function unrewriteText(text: string, opts: UnrewriteOptions): string {
  if (text.indexOf(RENAME_PREFIX) < 0) return text;
  const { leafNames } = opts;
  let out = "";
  let i = 0;
  const n = text.length;
  // Depth of structural risu_ blocks we are inside, so the structural rewrite's
  // `{{else}}` markers become `{{:else}}` only there.
  let structDepth = 0;

  while (i < n) {
    if (!text.startsWith("{{", i)) { out += text[i]; i += 1; continue; }

    if (text.startsWith("{{/", i)) {
      const close = text.indexOf("}}", i);
      if (close < 0) { out += text.slice(i); break; }
      const nameRaw = text.slice(i + 3, close);
      if (nameRaw.startsWith(RENAME_PREFIX)) {
        const kind = nameRaw.slice(RENAME_PREFIX.length);
        if (STRUCTURAL_KINDS.has(kind)) structDepth = Math.max(0, structDepth - 1);
        out += "{{/}}";
      } else {
        out += text.slice(i, close + 2);
      }
      i = close + 2;
      continue;
    }

    if (text.startsWith("{{#", i)) {
      const end = text.indexOf("}}", i);
      if (end < 0) { out += text.slice(i); break; }
      const header = text.slice(i + 3, end);
      if (header.startsWith(RENAME_PREFIX)) {
        const rest = header.slice(RENAME_PREFIX.length);
        const ci = rest.indexOf("::");
        const kind = ci < 0 ? rest : rest.slice(0, ci);
        const args = ci < 0 ? "" : rest.slice(ci + 2);
        if (STRUCTURAL_KINDS.has(kind)) {
          structDepth += 1;
          if (kind === "if" || kind === "if_pure") {
            out += args.length > 0 ? `{{#${kind} ${args}}}` : `{{#${kind}}}`;
          } else {
            out += args.length > 0 ? `{{#${kind}::${args}}}` : `{{#${kind}}}`;
          }
          i = end + 2;
          continue;
        }
        out += `{{#${rest}}}`;
        i = end + 2;
        continue;
      }
      out += text.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    const leafEnd = findLeafEnd(text, i);
    if (leafEnd < 0) { out += text.slice(i); break; }
    const inner = text.slice(i + 2, leafEnd - 2);

    if (structDepth > 0 && inner === "else") {
      out += "{{:else}}";
      i = leafEnd;
      continue;
    }

    if (inner.startsWith(RENAME_PREFIX)) {
      const rest = inner.slice(RENAME_PREFIX.length);
      const ci = rest.indexOf("::");
      const name = ci < 0 ? rest : rest.slice(0, ci);
      if (OPAQUE_KINDS.has(name)) {
        out += reconstructOpaque(name, splitTopLevel(inner));
        i = leafEnd;
        continue;
      }
      if (leafNames.has(name)) {
        out += `{{${rest}}}`;
        i = leafEnd;
        continue;
      }
    }

    out += text.slice(i, leafEnd);
    i = leafEnd;
  }
  return out;
}
