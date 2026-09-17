// Types for the in-worker CBS evaluator.

import type {
  MacroHandler,
  RisuRuntimeContext,
} from "../../core/cbs/index.js";

export type { MacroHandler, RisuRuntimeContext };

export interface EvaluatorCtx extends RisuRuntimeContext {
  readonly resolveLeaf?: (name: string, args: readonly string[]) => { text: string; terminal: boolean } | undefined;
  // For {{call::name::...}} recursive re-entry; cap matches Risu's 20.
  readonly callStack?: number;
}

export interface EvaluatorOptions {
  readonly displayMode?: boolean;
  // Starting callStack depth for recursive {{call::...}}. Default 0.
  readonly callStack?: number;
}

// Risu's blockStartMatcher return kinds  - parser.svelte.ts.
export type BlockKind =
  | "ignore"
  | "parse"
  | "nothing"
  | "ifpure"
  | "pure"
  | "each"
  | "function"
  | "pure-display"
  | "normalize"
  | "escape"
  | "newif"
  | "newif-falsy";

export interface BlockMatch {
  readonly type: BlockKind;
  readonly type2?: string;
  readonly funcArg?: readonly string[];
  readonly mode?: string;
}
