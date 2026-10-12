import { normalizeMacroName } from "../../../src/core/cbs/normalize.js";
import type { CbsNode, CbsTemplate, BlockKind, BlockNode } from "./ast.js";
import { lex, type Token } from "./lexer.js";

export function parseCbs(src: string): CbsTemplate {
  const tokens = lex(src);
  const parser = new Parser(tokens);
  return { nodes: parser.parseTemplate() };
}


/** Kinds whose body is an opaque string, not parsed into children. */
const OPAQUE_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  "pure", "pure_display", "ignore", "escape", "each", "func", "code",
]);

export function identifyBlockKind(headerAfterHash: string): BlockKind {
  let end = 0;
  while (end < headerAfterHash.length) {
    const c = headerAfterHash.charCodeAt(end);
    if (c === 0x3a /* : */ || c === 0x20 /* space */ || c === 0x09 /* tab */ || c === 0x0a /* \n */) break;
    end++;
  }
  const rawName = headerAfterHash.slice(0, end);
  const norm = normalizeMacroName(rawName);
  switch (norm) {
    case "if":
    case "ifpure": return "if";  // if_pure is a whitespace-preserving variant
    case "when": return "when";
    case "each": return "each";
    case "func":
    case "function": return "func";
    case "pure": return "pure";
    case "puredisplay": return "pure_display";
    case "ignore": return "ignore";
    case "escape": return "escape";
    case "code": return "code";
    default: return "unknown";
  }
}

export function parseMacroInner(raw: string): { name: string; args: string[] } {
  // {{? expr}} shortcut, surface as "calc" for dispatch.
  if (raw.startsWith("? ")) {
    return { name: "calc", args: [raw.slice(2)] };
  }
  const dblIdx = raw.indexOf("::");
  if (dblIdx >= 0) {
    const parts = raw.split("::");
    return { name: normalizeMacroName(parts[0] ?? ""), args: parts.slice(1) };
  }
  const colIdx = raw.indexOf(":");
  if (colIdx >= 0) {
    return { name: normalizeMacroName(raw.slice(0, colIdx)), args: [raw.slice(colIdx + 1)] };
  }
  return { name: normalizeMacroName(raw), args: [] };
}


class Parser {
  private i = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parseTemplate(stopOnBlockClose = false): CbsNode[] {
    const out: CbsNode[] = [];
    while (this.i < this.tokens.length) {
      const tok = this.tokens[this.i]!;
      if (tok.kind === "text") {
        out.push({ type: "text", value: tok.value });
        this.i++;
        continue;
      }
      if (tok.kind === "close") {
        // Orphan `}}` → text (Risu emits the raw character per default case).
        out.push({ type: "text", value: tok.value });
        this.i++;
        continue;
      }
      if (tok.kind === "legacy_close") {
        // Orphan `#}` → text.
        out.push({ type: "text", value: tok.value });
        this.i++;
        continue;
      }
      if (tok.kind === "legacy_open") {
        const node = this.tryLegacyBlock();
        out.push(node);
        continue;
      }
      // tok.kind === "open" (`{{`)
      const maybe = this.tryMacroOrBlock(stopOnBlockClose);
      if (maybe.kind === "nodes") {
        for (const n of maybe.nodes) out.push(n);
        continue;
      }
      if (maybe.kind === "block_close") {
        // Parent will consume the close token.
        return out;
      }
      // Should be unreachable  - exhaustiveness.
    }
    return out;
  }

  private tryMacroOrBlock(stopOnBlockClose: boolean):
    | { kind: "nodes"; nodes: CbsNode[] }
    | { kind: "block_close" }
  {
    const openTok = this.tokens[this.i]!;
    // Scan forward to the matching `}}`. If we don't find one, the opener is
    // a literal  - emit `{{` as text and advance past it.
    const closeIdx = this.findInnerClose(this.i + 1);
    if (closeIdx < 0) {
      this.i++;
      return { kind: "nodes", nodes: [{ type: "text", value: openTok.value }] };
    }

    const inner = this.collectInner(this.i + 1, closeIdx);
    this.i = closeIdx + 1; // past the `}}`

    // Classify the inner content.
    if (inner.startsWith("#")) {
      return { kind: "nodes", nodes: [this.parseBlock(inner)] };
    }
    if (inner.startsWith(":")) {
      // `:else` (or other separators) emerging at template top-level with no
      // enclosing if/when → Risu treats them as literal `{{…}}` text.
      return { kind: "nodes", nodes: [{
        type: "macro",
        name: normalizeMacroName(inner.slice(1)),
        args: [],
        raw: inner,
      }] };
    }
    if (inner.startsWith("/") && !inner.startsWith("//")) {
      if (stopOnBlockClose) {
        // Let the caller handle this close. Rewind past the close.
        this.i -= 0; // already past `}}`, parent will read inner via peek/consume protocol
        return { kind: "block_close" };
      }
      // Orphan close → Risu emits `{{/X}}` as literal.
      return { kind: "nodes", nodes: [{ type: "text", value: `{{${inner}}}` }] };
    }
    // Plain macro.
    const parsed = parseMacroInner(inner);
    return { kind: "nodes", nodes: [{
      type: "macro",
      name: parsed.name,
      args: parsed.args,
      raw: inner,
    }] };
  }

  private findInnerClose(from: number): number {
    let depth = 0;
    for (let k = from; k < this.tokens.length; k++) {
      const t = this.tokens[k]!;
      if (t.kind === "open") depth++;
      else if (t.kind === "close") {
        if (depth === 0) return k;
        depth--;
      }
    }
    return -1;
  }

  /** Collect text between token indices [from, closeIdx) as a plain string. */
  private collectInner(from: number, closeIdx: number): string {
    let s = "";
    for (let k = from; k < closeIdx; k++) s += this.tokens[k]!.value;
    return s;
  }

  private parseBlock(headerWithHash: string): BlockNode {
    const headerRaw = headerWithHash.slice(1); // drop leading '#'
    const kind = identifyBlockKind(headerRaw);

    if (OPAQUE_KINDS.has(kind)) {
      const { bodyRaw, closeRaw } = this.consumeOpaqueBody();
      return { type: "block", kind, headerRaw, bodyRaw, closeRaw };
    }
    // Structural: recurse for children, watch for `{{:else}}` and `{{/X}}`.
    return this.parseStructuralBlock(kind, headerRaw);
  }

  private consumeOpaqueBody(): { bodyRaw: string; closeRaw: string } {
    let body = "";
    let depth = 0;
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i]!;
      if (t.kind === "text" || t.kind === "legacy_open" || t.kind === "legacy_close") {
        body += t.value;
        this.i++;
        continue;
      }
      if (t.kind === "close") {
        body += t.value;
        this.i++;
        continue;
      }
      // open `{{`
      const closeIdx = this.findInnerClose(this.i + 1);
      if (closeIdx < 0) {
        // Unterminated  - capture opener as literal body and move on.
        body += t.value;
        this.i++;
        continue;
      }
      const inner = this.collectInner(this.i + 1, closeIdx);
      if (inner.startsWith("#")) {
        // Inner block-open while inside opaque body  - balances.
        depth++;
        body += `{{${inner}}}`;
        this.i = closeIdx + 1;
        continue;
      }
      if (inner.startsWith("/") && !inner.startsWith("//")) {
        if (depth === 0) {
          // This is OUR closing block.
          this.i = closeIdx + 1;
          return { bodyRaw: body, closeRaw: inner };
        }
        depth--;
        body += `{{${inner}}}`;
        this.i = closeIdx + 1;
        continue;
      }
      // plain macro or separator  - literal inside opaque body
      body += `{{${inner}}}`;
      this.i = closeIdx + 1;
    }
    // EOF without close.
    return { bodyRaw: body, closeRaw: "" };
  }

    private parseStructuralBlock(kind: BlockKind, headerRaw: string): BlockNode {
    const children: CbsNode[] = [];
    const elseChildren: CbsNode[] = [];
    let bucket = children;
    let seenElse = false;
    let closeRaw = "";

    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i]!;
      if (t.kind === "text") {
        bucket.push({ type: "text", value: t.value });
        this.i++;
        continue;
      }
      if (t.kind === "close") {
        bucket.push({ type: "text", value: t.value });
        this.i++;
        continue;
      }
      if (t.kind === "legacy_close") {
        bucket.push({ type: "text", value: t.value });
        this.i++;
        continue;
      }
      if (t.kind === "legacy_open") {
        bucket.push(this.tryLegacyBlock());
        continue;
      }
      // `{{`
      const closeIdx = this.findInnerClose(this.i + 1);
      if (closeIdx < 0) {
        // Unterminated `{{` → emit as literal and stop; EOF will unwind.
        bucket.push({ type: "text", value: t.value });
        this.i++;
        continue;
      }
      const inner = this.collectInner(this.i + 1, closeIdx);
      if (inner.startsWith("#")) {
        this.i = closeIdx + 1;
        bucket.push(this.parseBlock(inner));
        continue;
      }
      if (inner.startsWith(":")) {
        const sepName = normalizeMacroName(inner.slice(1));
        if (sepName === "else" && (kind === "if" || kind === "when")) {
          this.i = closeIdx + 1;
          bucket = elseChildren;
          seenElse = true;
          continue;
        }
        // Unknown separator  - treat as plain macro node.
        this.i = closeIdx + 1;
        bucket.push({ type: "macro", name: sepName, args: [], raw: inner });
        continue;
      }
      if (inner.startsWith("/") && !inner.startsWith("//")) {
        // Close our block.
        this.i = closeIdx + 1;
        closeRaw = inner;
        const blk: BlockNode = seenElse
          ? { type: "block", kind, headerRaw, children, elseChildren, closeRaw }
          : { type: "block", kind, headerRaw, children, closeRaw };
        return blk;
      }
      // Plain macro.
      this.i = closeIdx + 1;
      const parsed = parseMacroInner(inner);
      bucket.push({ type: "macro", name: parsed.name, args: parsed.args, raw: inner });
    }
    // EOF before close  - return what we have (closeRaw empty, serializer will
    // omit the close to preserve source shape).
    return seenElse
      ? { type: "block", kind, headerRaw, children, elseChildren, closeRaw: "" }
      : { type: "block", kind, headerRaw, children, closeRaw: "" };
  }

  private tryLegacyBlock(): CbsNode {
    const openTok = this.tokens[this.i]!;
    // Find first `legacy_close` at depth 0 (legacy blocks don't nest in Risu).
    let k = this.i + 1;
    while (k < this.tokens.length) {
      if (this.tokens[k]!.kind === "legacy_close") break;
      k++;
    }
    if (k >= this.tokens.length) {
      // No terminator  - emit as literal text.
      this.i++;
      return { type: "text", value: openTok.value };
    }
    let raw = "";
    for (let j = this.i + 1; j < k; j++) raw += this.tokens[j]!.value;
    this.i = k + 1;
    return { type: "legacy", raw };
  }
}
