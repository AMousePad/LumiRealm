import type { TriggerEffect } from "../../../src/core/schemas/triggerscript.js";

export interface EmitContext {
  readonly indent: number;
  readonly issues: EmitIssue[];
  readonly lowLevelAccess: boolean;
  readonly displayMode: boolean;
  readonly loopDepth: number;
}

export interface EmitIssue {
  readonly opcode: string;
  readonly message: string;
  readonly severity: "warn" | "error";
}

export interface EmitResult {
  readonly code: string;
  readonly needsAwait: boolean;
}

export type EmitFn = (op: TriggerEffect, ctx: EmitContext) => EmitResult;

export function resolveCall(value: string, kind: "var" | "value" | string): string {
  return `__risu.resolve(${JSON.stringify(value)}, ${JSON.stringify(kind)})`;
}

export function setVarCall(name: string, value: string): string {
  return `__risu.setVar(${JSON.stringify(name)}, ${value})`;
}

export function getVarCall(name: string): string {
  return `__risu.getVar(${JSON.stringify(name)})`;
}

export function indent(ctx: EmitContext): string {
  return "  ".repeat(Math.max(0, ctx.indent));
}

export function line(ctx: EmitContext, body: string): string {
  return indent(ctx) + body;
}
