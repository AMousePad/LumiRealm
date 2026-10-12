
export type BlockKind =
  | "if"
  | "when"
  | "each"
  | "func"
  | "pure"
  | "pure_display"
  | "ignore"
  | "escape"
  | "code"
  | "unknown";

export interface TextNode {
  readonly type: "text";
  readonly value: string;
}

export interface MacroNode {
  readonly type: "macro";
  /** Normalized name (Risu parser.svelte.ts). Used for dispatch. */
  readonly name: string;
  /** `::`-split arguments after the name token. Empty if no args. */
  readonly args: readonly string[];
  /** Exact content between `{{` and `}}`. Preserved for round-trip. */
  readonly raw: string;
}

export interface BlockNode {
  readonly type: "block";
  readonly kind: BlockKind;
  readonly headerRaw: string;
  readonly closeRaw: string;
  readonly children?: readonly CbsNode[];
  readonly elseChildren?: readonly CbsNode[];
  /** Present for opaque blocks (pure, escape, each, func, code, ignore, pure_display). */
  readonly bodyRaw?: string;
}

/** Legacy `{#…#}` form. Preserved for round-trip. */
export interface LegacyNode {
  readonly type: "legacy";
  readonly raw: string;
}

export type CbsNode = TextNode | MacroNode | BlockNode | LegacyNode;

/** Top-level AST root. */
export interface CbsTemplate {
  readonly nodes: readonly CbsNode[];
}
