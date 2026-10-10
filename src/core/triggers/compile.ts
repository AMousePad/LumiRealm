import type { TriggerEffect, TriggerScript } from "../schemas/triggerscript.js";
import type { EmitContext, EmitIssue } from "./types.js";
import { indent } from "./types.js";
import { EMITTERS } from "./opcodes/index.js";
import { CONTROL_OPS } from "./control-flow.js";
import { triggerNeedsTemplates } from './templates.js';


export interface CompileTriggerOptions {
  readonly comment?: string;
  readonly lowLevelAccess?: boolean;
  readonly displayMode?: boolean;
  readonly baseIndent?: number;
}

export interface CompileTriggerResult {
  readonly body: string;
  readonly issues: readonly EmitIssue[];
  readonly unimplementedCounts: Readonly<Record<string, number>>;
  readonly hasConditions: boolean;
}

export function compileTrigger(
  trigger: TriggerScript,
  opts: CompileTriggerOptions = {},
): CompileTriggerResult {
  const issues: EmitIssue[] = [];
  const baseIndent = opts.baseIndent ?? 1;
  const ctx: EmitContext = {
    indent: baseIndent,
    issues,
    lowLevelAccess: Boolean(opts.lowLevelAccess ?? trigger.lowLevelAccess ?? false),
    displayMode: Boolean(opts.displayMode ?? false),
    loopDepth: 0,
  };

  const out: string[] = [];
  if (triggerNeedsTemplates(trigger)) {
    out.push(line(ctx, 'await __risu.prepareTemplates();'));
  }

  const hasConditions = Array.isArray(trigger.conditions) && trigger.conditions.length > 0;
  if (hasConditions) {
    out.push(line(ctx, `if (!__risu.checkConditions(${JSON.stringify(trigger.conditions)})) return;`));
  }

  const effects = (trigger.effect ?? []) as readonly TriggerEffect[];
  if (effects.length > 0) {
    const controlEffects = effects.map(effect => CONTROL_OPS.has(effect.type) ? effect
      : { type: effect.type, ...('indent' in effect ? { indent: effect.indent } : {}) });
    out.push(line(ctx, `const __effects = ${JSON.stringify(controlEffects)};`));
    out.push(line(ctx, `const __control = { loops: {}, ticks: 0 };`));
    out.push(line(ctx, `for (let __index = 0; __index < __effects.length; __index++) {`));
    const inner = { ...ctx, indent: ctx.indent + 1 };
    out.push(line(inner, `const __next = await __risu.advanceControl(__effects, __index, __control);`));
    out.push(line(inner, `if (__next !== undefined) { __index = __next; continue; }`));
    out.push(line(inner, `switch (__index) {`));
    const leafCtx = { ...inner, indent: inner.indent + 2 };
    for (const [index, op] of effects.entries()) {
      if (CONTROL_OPS.has(op.type)) continue;
      const emitter = EMITTERS[op.type];
      if (!emitter) {
        issues.push({ opcode: op.type, message: "unknown opcode: likely a newer RisuAI version. Card may not work properly. Contact `amousepad` on Discord if you see this message.", severity: "warn" });
        out.push(line(inner, "/* unknown opcode skipped */"));
        continue;
      }
      out.push(line(inner, `case ${index}: {`));
      out.push(emitter(op, leafCtx).code);
      out.push(line(leafCtx, `break;`));
      out.push(line(inner, `}`));
    }
    out.push(line(inner, `}`));
    out.push(line(ctx, `}`));
  }

  const unimplementedCounts: Record<string, number> = {};
  for (const issue of issues) {
    if (!issue.message.startsWith("unknown opcode")) continue;
    unimplementedCounts[issue.opcode] = (unimplementedCounts[issue.opcode] ?? 0) + 1;
  }

  return {
    body: out.filter((s) => s.length > 0).join("\n"),
    issues,
    unimplementedCounts,
    hasConditions,
  };
}

function line(ctx: EmitContext, body: string): string {
  return indent(ctx) + body;
}
