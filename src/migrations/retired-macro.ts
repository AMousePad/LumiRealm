// One-release storage migration for macro names emitted by LumiRealm's retired
// static CBS projection. This is deliberately not imported by the evaluator.

const RETIRED_PREFIX = "risu_";

const STRUCTURAL_KINDS = new Set(["if", "if_pure", "when"]);
const OPAQUE_KINDS = new Set([
  "each",
  "func",
  "pure",
  "pure_display",
  "ignore",
  "escape",
  "code",
  "legacy",
]);
const RAW_OPAQUE_BLOCK_NAMES = new Set([
  "each",
  "func",
  "pure",
  "pure_display",
  "puredisplay",
  "ignore",
  "escape",
  "code",
]);

const OPEN_BRACES = "\uE9B8\uE9B9";
const CLOSE_BRACES = "\uE9BA\uE9BB";
const DOUBLE_COLON = "\uE9BC\uE9BD";

function decodeProjectedBody(input: string): string {
  return input
    .replaceAll(DOUBLE_COLON, "::")
    .replaceAll(CLOSE_BRACES, "}}")
    .replaceAll(OPEN_BRACES, "{{");
}

// End index past the `}}` closing a `{{` opened at `open`, balancing nested
// macro expressions in arguments.
function findMacroEnd(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (text.startsWith("}}", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return -1;
}

function splitTopLevel(payload: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < payload.length) {
    if (payload.startsWith("{{", i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (payload.startsWith("}}", i)) {
      depth -= 1;
      i += 2;
      continue;
    }
    if (depth === 0 && payload.startsWith("::", i)) {
      parts.push(payload.slice(last, i));
      i += 2;
      last = i;
      continue;
    }
    i += 1;
  }
  parts.push(payload.slice(last));
  return parts;
}

function blockName(header: string): string {
  let end = 0;
  while (end < header.length) {
    const c = header.charCodeAt(end);
    if (
      c === 0x3a || // :
      c === 0x20 || // space
      c === 0x09 || // tab
      c === 0x0a || // newline
      c === 0x0d // carriage return
    ) {
      break;
    }
    end += 1;
  }
  return header.slice(0, end);
}

function splitMacroHead(payload: string): { name: string; rest: string } {
  const name = blockName(payload);
  return { name, rest: payload.slice(name.length) };
}

function findRawOpaqueBlockEnd(
  text: string,
  bodyStart: number,
  name: string,
): number {
  const namedClose = `{{/${name}}}`;
  const namedAt = text.indexOf(namedClose, bodyStart);
  const shortClose = "{{/}}";
  const shortAt = text.indexOf(shortClose, bodyStart);
  if (namedAt < 0 && shortAt < 0) return -1;
  if (namedAt >= 0 && (shortAt < 0 || namedAt < shortAt)) {
    return namedAt + namedClose.length;
  }
  return shortAt + shortClose.length;
}

function repairProjectedUnknownHeader(
  projected: string,
  text: string,
  bodyStart: number,
): string {
  const parts = splitTopLevel(projected);
  const tail = parts.slice(1);
  if (tail.length < 2 || tail.length % 2 !== 0) return projected;
  const half = tail.length / 2;
  for (let index = 0; index < half; index += 1) {
    if (tail[index] !== tail[index + half]) return projected;
  }
  const candidate = [parts[0] ?? "", ...tail.slice(0, half)].join("::");
  return text.indexOf(`{{/${RETIRED_PREFIX}${candidate}}}`, bodyStart) >= 0
    ? candidate
    : projected;
}

function reconstructOpaque(kind: string, segments: string[]): string {
  // The old projection encoded opaque bodies before its nested-name post-pass,
  // so names inside the decoded body were authored text, not generated names.
  const body = decodeProjectedBody(segments[segments.length - 1] ?? "");
  if (kind === "legacy") return `{#${body}#}`;
  const header = migrateRetiredMacroNames(
    segments.slice(1, -1).join("::"),
  );
  const keepHeader =
    (kind === "each" || kind === "escape") &&
    (header === "keep" || header.startsWith("keep "));
  const opener = header.length === 0
    ? `{{#${kind}}}`
    : keepHeader
      ? `{{#${kind}::${header}}}`
      : `{{#${kind} ${header}}}`;
  return `${opener}${body}{{/${kind}}}`;
}

/**
 * Restores raw Risu CBS in stored strings produced by the retired static
 * projection. Plain text, attributes, metadata keys, and already-raw CBS are
 * byte-identical. Dynamically assembled fragments are intentionally outside
 * this one-time migration.
 */
export function migrateRetiredMacroNames(text: string): string {
  if (!text.includes(RETIRED_PREFIX)) return text;

  let out = "";
  let i = 0;
  const blocks: Array<{ name: string; convertsElse: boolean }> = [];

  while (i < text.length) {
    if (!text.startsWith("{{", i)) {
      out += text[i];
      i += 1;
      continue;
    }

    if (text.startsWith("{{/", i)) {
      const end = text.indexOf("}}", i);
      if (end < 0) {
        out += text.slice(i);
        break;
      }
      const name = text.slice(i + 3, end);
      const restoredFullName = name.startsWith(RETIRED_PREFIX)
        ? name.slice(RETIRED_PREFIX.length)
        : name;
      const restoredName = blockName(restoredFullName);
      if (name.startsWith(RETIRED_PREFIX)) {
        out += `{{/${restoredName}}}`;
      } else {
        out += text.slice(i, end + 2);
      }
      if (blocks.length > 0) {
        if (restoredName.length === 0) {
          blocks.pop();
        } else {
          let matching = -1;
          for (let index = blocks.length - 1; index >= 0; index -= 1) {
            if (blocks[index]?.name === restoredName) {
              matching = index;
              break;
            }
          }
          if (matching >= 0) blocks.splice(matching);
        }
      }
      i = end + 2;
      continue;
    }

    if (text.startsWith("{{#", i)) {
      const end = findMacroEnd(text, i);
      if (end < 0) {
        out += text.slice(i);
        break;
      }
      const header = text.slice(i + 3, end - 2);
      if (header.startsWith(RETIRED_PREFIX)) {
        const projected = header.slice(RETIRED_PREFIX.length);
        const { name: kind, rest } = splitMacroHead(projected);
        if (STRUCTURAL_KINDS.has(kind)) {
          const args = rest.startsWith("::") ? rest.slice(2) : rest.trimStart();
          const migratedArgs = migrateRetiredMacroNames(args);
          blocks.push({ name: kind, convertsElse: true });
          if ((kind === "if" || kind === "if_pure") && migratedArgs.length > 0) {
            out += `{{#${kind} ${migratedArgs}}}`;
          } else {
            out += migratedArgs.length > 0
              ? `{{#${kind}::${migratedArgs}}}`
              : `{{#${kind}}}`;
          }
        } else {
          const restoredHeader = migrateRetiredMacroNames(
            repairProjectedUnknownHeader(projected, text, end),
          );
          const restoredBlockName = blockName(restoredHeader);
          blocks.push({ name: restoredBlockName, convertsElse: false });
          out += `{{#${restoredHeader}}}`;
        }
      } else {
        const rawName = blockName(header);
        if (RAW_OPAQUE_BLOCK_NAMES.has(rawName)) {
          const opaqueEnd = findRawOpaqueBlockEnd(text, end, rawName);
          if (opaqueEnd < 0) {
            out += text.slice(i);
            break;
          }
          out += text.slice(i, opaqueEnd);
          i = opaqueEnd;
          continue;
        }
        const migratedHeader = migrateRetiredMacroNames(header);
        out += `{{#${migratedHeader}}}`;
        blocks.push({ name: blockName(migratedHeader), convertsElse: false });
      }
      i = end;
      continue;
    }

    const end = findMacroEnd(text, i);
    if (end < 0) {
      out += text.slice(i);
      break;
    }
    const inner = text.slice(i + 2, end - 2);

    if (blocks.at(-1)?.convertsElse === true && inner === "else") {
      out += "{{:else}}";
      i = end;
      continue;
    }

    if (inner.startsWith(RETIRED_PREFIX)) {
      const projected = inner.slice(RETIRED_PREFIX.length);
      const { name, rest } = splitMacroHead(projected);
      if (OPAQUE_KINDS.has(name) && rest.startsWith("::")) {
        out += reconstructOpaque(name, splitTopLevel(inner));
      } else {
        out += `{{${name}${migrateRetiredMacroNames(rest)}}}`;
      }
      i = end;
      continue;
    }

    const migratedInner = migrateRetiredMacroNames(inner);
    out += migratedInner === inner
      ? text.slice(i, end)
      : `{{${migratedInner}}}`;
    i = end;
  }

  return out;
}
