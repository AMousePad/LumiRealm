// Port of Risu's risuChatParser. Direct character-scanner. The #each loop
// splices expanded body back into source so the main scan continues over it.
// Do not replace with recursion. Deviations: handlers write ctx.vars.set
// instead of returning {text, var}, and pureModeNest uses one Map.

import type { EvaluatorCtx, EvaluatorOptions, BlockMatch } from "./types.js";
import { blockStartMatcher, blockEndMatcher, risuEscape } from "./scoped.js";
import { legacyBlockMatcher } from "./legacy.js";
import { parseArray } from "./parse-array.js";
import { lookup } from "./dispatch.js";
import { normalizeMacroName } from "../../core/cbs/index.js";

const CALL_STACK_LIMIT = 20;


// `::` wins over `:` when present (Risu parity).
function splitMacroArgs(payload: string): { name: string; args: string[] } {
  const colon = payload.indexOf(":");
  let parts: string[];
  if (colon !== -1 && payload[colon + 1] === ":") {
    parts = payload.split("::");
  } else {
    parts = payload.split(":");
  }
  return { name: parts[0] ?? "", args: parts.slice(1) };
}

// Handles `{{? expr}}` calc shortcut. Risu matcher() tries calcString for this prefix.
function tryCalcShortcut(payload: string, ctx: EvaluatorCtx): string | null {
  if (!payload.startsWith("? ")) return null;
  const expr = payload.substring(2);
  const entry = lookup("calc");
  if (!entry) return null;
  try {
    return entry.handler(ctx, [expr], "calc::" + expr);
  } catch {
    return null;
  }
}

// Returns null for unhandled payloads (scanner emits {{payload}} verbatim, Risu parity).
function dispatchLeaf(
  payload: string,
  ctx: EvaluatorCtx,
  callStack: number,
): string | null {
  const calc = tryCalcShortcut(payload, ctx);
  if (calc !== null) return calc;

  const { name, args } = splitMacroArgs(payload);
  const entry = lookup(name);
  if (!entry) return null;

  try {
    const result = entry.handler(ctx, args, payload);
    if (typeof result === "string" && result.includes("{{") && result !== `{{${payload}}}`) {
      return evaluate(result, ctx, { callStack });
    }
    return result;
  } catch {
    return null;
  }
}

function rewindLastWord(root: string): string {
  if (!root) return root;
  const trimmed = root.trimEnd();
  let trimPointer = trimmed.length - 1;
  for (; trimPointer >= 0; trimPointer--) {
    const char = trimmed[trimPointer];
    if (trimPointer === 0 || char === " " || char === "\n" || char === "\t") break;
  }
  if (trimPointer === -1) trimPointer = 0;
  return trimmed.substring(0, trimPointer).trimEnd();
}

function rewindLastSentence(root: string): string {
  if (!root) return root;
  const trimmed = root.trimEnd();
  let trimPointer = trimmed.length - 1;
  let sentenceEndFound = false;
  for (; trimPointer >= 0; trimPointer--) {
    const char = trimmed[trimPointer];
    if (char === "." || char === "!" || char === "?" || char === "\n") {
      sentenceEndFound = true;
      break;
    }
    if (trimPointer === 0) break;
  }
  if (trimPointer === -1) trimPointer = 0;
  else if (sentenceEndFound) trimPointer += 1;
  return trimmed.substring(0, trimPointer).trimEnd();
}

export function evaluate(
  template: string,
  ctx: EvaluatorCtx,
  opts: EvaluatorOptions = {},
): string {
  const callStack = (opts.callStack ?? ctx.callStack ?? 0) + 1;
  if (callStack > CALL_STACK_LIMIT) {
    return "ERROR: Call stack limit reached";
  }
  const innerCtx: EvaluatorCtx = callStack === ctx.callStack ? ctx
    : Object.assign(Object.create(Object.getPrototypeOf(ctx) ?? null), ctx, {
        callStack,
      });

  let da = template.replace(/<(user|char|bot)>/gi, "{{$1}}");

  let pointer = 0;
  const nested: string[] = [""];
  // stackType: 1=brace, 5=block body, 6=pure-mode nested block.

  const stackType: number[] = new Array(512).fill(0);
  const pureModeNest = new Map<number, boolean>();
  const blockNestType = new Map<number, BlockMatch>();

  const isPureMode = () => pureModeNest.size > 0;

  while (pointer < da.length) {
    const ch = da[pointer]!;
    switch (ch) {
      case "{": {
        if (da[pointer + 1] !== "{" && da[pointer + 1] !== "#") {
          nested[0] += ch;
          break;
        }
        pointer++;
        nested.unshift("");
        stackType[nested.length] = 1;
        break;
      }
      case "#": {
        // Legacy {#if cond\nbody#} form.
        if (
          da[pointer + 1] !== "}"
          || nested.length === 1
          || stackType[nested.length] !== 1
        ) {
          nested[0] += ch;
          break;
        }
        pointer++;
        const dat = nested.shift()!;
        const mc = legacyBlockMatcher(dat);
        nested[0] += mc ?? `{#${dat}#}`;
        break;
      }
      case "}": {
        if (
          da[pointer + 1] !== "}"
          || nested.length === 1
          || stackType[nested.length] !== 1
        ) {
          nested[0] += ch;
          break;
        }
        pointer++;
        const dat = nested.shift()!;

        // Block opener: {{#foo ...}} / {{:else}}.
        if (dat.startsWith("#") || dat.startsWith(":")) {
          if (isPureMode()) {
            nested[0] += `{{${dat}}}`;
            if (dat !== ":else") {
              nested.unshift("");
              stackType[nested.length] = 6;
            }
            break;
          }
          const matchResult = blockStartMatcher(dat, innerCtx);
          if (matchResult.type === "nothing") {
            nested[0] += `{{${dat}}}`;
            break;
          }
          nested.unshift("");
          stackType[nested.length] = 5;
          blockNestType.set(nested.length, matchResult);
          if (
            matchResult.type === "ignore"
            || matchResult.type === "pure"
            || matchResult.type === "each"
            || matchResult.type === "function"
            || matchResult.type === "pure-display"
            || matchResult.type === "escape"
          ) {
            pureModeNest.set(nested.length, true);
          }
          break;
        }

        // Block closer: {{/foo}}.
        if (dat.startsWith("/") && !dat.startsWith("//")) {
          if (stackType[nested.length] === 5) {
            const blockType = blockNestType.get(nested.length)!;
            if (
              blockType.type === "ignore"
              || blockType.type === "pure"
              || blockType.type === "each"
              || blockType.type === "function"
              || blockType.type === "pure-display"
              || blockType.type === "escape"
            ) {
              pureModeNest.delete(nested.length);
            }
            blockNestType.delete(nested.length);
            const body = nested.shift()!;
            const matchResult = blockEndMatcher(body, blockType);

            if (blockType.type === "each") {
              const type2 = blockType.type2 ?? "";
              const asIndex = type2.lastIndexOf(" as ");
              let sub: string;
              let array: unknown[];
              if (asIndex === -1) {
                const subind = type2.lastIndexOf(" ");
                if (subind === -1) {
                  break;
                }
                sub = type2.substring(subind + 1);
                array = parseArray(type2.substring(0, subind));
              } else {
                sub = type2.substring(asIndex + 4).trim();
                array = parseArray(type2.substring(0, asIndex));
              }
              let added = "";
              for (let i = 0; i < array.length; i++) {
                const v = array[i];
                const valueStr = typeof v === "string" ? v : JSON.stringify(v);
                added += matchResult.replaceAll(`{{slot::${sub}}}`, valueStr);
              }
              const toInsert = blockType.mode === "keep" ? added : added.trim();
              da = da.substring(0, pointer + 1) + toInsert + da.substring(pointer + 1);
              break;
            }
            if (blockType.type === "function") {
              const funcArg = blockType.funcArg ?? [];
              innerCtx.functions.define(
                funcArg[0] ?? "",
                matchResult,
                funcArg.slice(1),
              );
              break;
            }
            if (blockType.type === "ignore") {
              break;
            }
            if (blockType.type === "pure-display") {
              nested[0] += matchResult
                .replaceAll("{{", "\\{\\{")
                .replaceAll("}}", "\\}\\}");
              break;
            }
            if (matchResult === "") break;
            nested[0] += matchResult;
            break;
          }
          if (stackType[nested.length] === 6) {
            const sft = nested.shift()!;
            nested[0] += sft + `{{${dat}}}`;
            break;
          }
        }

        // {{call::name::arg0::arg1}}
        if (dat.startsWith("call::")) {
          if (callStack > CALL_STACK_LIMIT) {
            nested[0] += "ERROR: Call stack limit reached";
            break;
          }
          const argData = dat.split("::").slice(1);
          const funcName = argData[0] ?? "";
          const func = innerCtx.functions.get(funcName);
          if (func) {
            let data = func.body;
            for (let i = 0; i < argData.length; i++) {
              data = data.replaceAll(`{{arg::${i}}}`, argData[i] ?? "");
            }
            nested[0] += evaluate(data, innerCtx, { callStack });
            break;
          }
        }

        const leafName = normalizeMacroName(splitMacroArgs(dat).name);
        if (!isPureMode() && leafName === "bkspc") {
          nested[0] = rewindLastWord(nested[0] ?? "");
          break;
        }
        if (!isPureMode() && leafName === "erase") {
          nested[0] = rewindLastSentence(nested[0] ?? "");
          break;
        }

        const mc = isPureMode() ? null : dispatchLeaf(dat, innerCtx, callStack);
        if (mc == null) {
          nested[0] += `{{${dat}}}`;
        } else {
          nested[0] += mc;
        }
        // Risu parser.svelte.ts: parser short-circuits when {{return::v}} sets __force_return__. Reset the flags so outer evaluate calls (description recursion etc.) don't inherit the halt.
        if (innerCtx.vars.get("temp", "__force_return__") === "1") {
          const ret = innerCtx.vars.get("temp", "__return__") || "null";
          innerCtx.vars.delete("temp", "__force_return__");
          innerCtx.vars.delete("temp", "__return__");
          return ret;
        }
        break;
      }
      default:
        nested[0] += ch;
    }
    pointer++;
  }

  // Unterminated braces: rebuild preserving opener sentinels.
  if (nested.length === 1) {
    return nested[0]!;
  }
  let result = "";
  while (nested.length > 1) {
    const dat = (stackType[nested.length] === 1 ? "{{" : "<") + nested.shift()!;
    result = dat + result;
  }
  return nested[0] + result;
}

// Re-exports for scanner consumers.
export { risuEscape, normalizeMacroName };
