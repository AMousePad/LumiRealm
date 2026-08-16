// Risu parser.svelte.ts blockStartMatcher / blockEndMatcher / trimLines / risuEscape.

import type { BlockMatch, EvaluatorCtx, BlockKind } from "./types.js";

// Trim before truthy comparison because card-authored block arguments may
// contain trailing whitespace.
function isTruthy(s: string): boolean {
  const t = s.trim();
  return t === "true" || t === "1";
}

export function trimLines(p1: string): string {
  return p1.split("\n").map((v) => v.trimStart()).join("\n").trim();
}

export function risuEscape(text: string): string {
  return text.replace(/[{}()]/g, (f) => {
    switch (f) {
      case "{": return "";
      case "}": return "";
      case "(": return "";
      case ")": return "";
      default: return f;
    }
  });
}

export function blockStartMatcher(input: string, ctx: EvaluatorCtx): BlockMatch {
  const p1 = input;
  if (p1.startsWith("#if") || p1.startsWith("#if_pure ")) {
    const statement = p1.split(" ", 2);
    const state = statement[1];
    if (state === "true" || state === "1") {
      return { type: p1.startsWith("#if_pure") ? "ifpure" : "parse" };
    }
    return { type: "ignore" };
  }

  if (p1.startsWith("#when")) {
    if (p1.startsWith("#when ")) {
      const statement = p1.split(" ", 2);
      const state = statement[1];
      return { type: (state === "true" || state === "1") ? "newif" : "newif-falsy" };
    } else if (p1.startsWith("#when::")) {
      const statement = p1.split("::").slice(1);
      if (statement.length === 1) {
        const state = statement[0]!;
        return { type: (state === "true" || state === "1") ? "newif" : "newif-falsy" };
      }
      let mode: "normal" | "keep" | "legacy" = "normal";
      while (statement.length > 1) {
        const condition = statement.pop()!;
        const operator = statement.pop()!;
        switch (operator) {
          case "not":
            statement.push(isTruthy(condition) ? "0" : "1");
            break;
          case "keep":
            mode = "keep";
            statement.push(condition);
            break;
          case "legacy":
            mode = "legacy";
            statement.push(condition);
            break;
          case "and": {
            const c2 = statement.pop()!;
            statement.push(isTruthy(condition) && isTruthy(c2) ? "1" : "0");
            break;
          }
          case "or": {
            const c2 = statement.pop()!;
            statement.push(isTruthy(condition) || isTruthy(c2) ? "1" : "0");
            break;
          }
          case "is": {
            const c2 = statement.pop()!;
            statement.push(condition === c2 ? "1" : "0");
            break;
          }
          case "isnot": {
            const c2 = statement.pop()!;
            statement.push(condition !== c2 ? "1" : "0");
            break;
          }
          case "var": {
            const v = ctx.vars.get("local", condition);
            statement.push(isTruthy(v) ? "1" : "0");
            break;
          }
          case "toggle": {
            const v = ctx.vars.get("global", "toggle_" + condition);
            statement.push(isTruthy(v) ? "1" : "0");
            break;
          }
          case "vis": {
            const name = statement.pop()!;
            statement.push(ctx.vars.get("local", name) === condition ? "1" : "0");
            break;
          }
          case "visnot": {
            const name = statement.pop()!;
            statement.push(ctx.vars.get("local", name) !== condition ? "1" : "0");
            break;
          }
          case "tis": {
            const name = statement.pop()!;
            statement.push(ctx.vars.get("global", "toggle_" + name) === condition ? "1" : "0");
            break;
          }
          case "tisnot": {
            const name = statement.pop()!;
            statement.push(ctx.vars.get("global", "toggle_" + name) !== condition ? "1" : "0");
            break;
          }
          case ">": {
            const c2 = statement.pop()!;
            statement.push(parseFloat(c2) > parseFloat(condition) ? "1" : "0");
            break;
          }
          case "<": {
            const c2 = statement.pop()!;
            statement.push(parseFloat(c2) < parseFloat(condition) ? "1" : "0");
            break;
          }
          case ">=": {
            const c2 = statement.pop()!;
            statement.push(parseFloat(c2) >= parseFloat(condition) ? "1" : "0");
            break;
          }
          case "<=": {
            const c2 = statement.pop()!;
            statement.push(parseFloat(c2) <= parseFloat(condition) ? "1" : "0");
            break;
          }
          default:
            statement.push(isTruthy(condition) ? "1" : "0");
        }
      }
      const finalCondition = statement[0]!;
      if (isTruthy(finalCondition)) {
        if (mode === "keep") return { type: "newif", type2: "keep" };
        if (mode === "legacy") return { type: "parse" };
        return { type: "newif" };
      }
      if (mode === "keep") return { type: "newif-falsy", type2: "keep" };
      if (mode === "legacy") return { type: "ignore" };
      return { type: "newif-falsy" };
    }
    return { type: "newif-falsy" };
  }

  if (p1 === "#pure") return { type: "pure" };
  if (p1 === "#pure_display" || p1 === "#puredisplay") return { type: "pure-display" };
  if (p1 === "#ignore") return { type: "ignore" };
  if (p1 === "#code") return { type: "normalize" };
  if (p1.startsWith("#escape")) {
    const t2 = p1.substring(7).trim();
    const mode = t2 === "::keep" ? "keep" : undefined;
    return { type: "escape", ...(mode ? { mode } : {}) };
  }
  if (p1.startsWith("#each")) {
    let t2 = p1.substring(5).trim();
    let mode: string | undefined;
    if (t2.startsWith("::keep ")) {
      mode = "keep";
      t2 = t2.substring(7).trim();
    }
    if (t2.startsWith("as ")) {
      t2 = t2.substring(3).trim();
    }
    return { type: "each", type2: t2, ...(mode ? { mode } : {}) };
  }
  if (p1.startsWith("#func")) {
    const statement = p1.split(" ");
    if (statement.length > 1) {
      return { type: "function", funcArg: statement.slice(1) };
    }
  }

  return { type: "nothing" };
}

// parser.svelte.ts.
export function blockEndMatcher(
  p1: string,
  type: { type: BlockKind; type2?: string; mode?: string },
): string {
  const p1Trimmed = p1.trim();
  switch (type.type) {
    case "pure":
    case "pure-display":
    case "function":
      return p1Trimmed;
    case "parse":
      return trimLines(p1Trimmed);
    case "each":
      if (type.mode === "keep") return p1;
      return trimLines(p1Trimmed);
    case "ifpure":
      return p1;
    case "newif":
    case "newif-falsy": {
      const findElse = (s: string): { index: number; len: number } => {
        const index = s.indexOf("{{:else}}");
        return { index, len: index === -1 ? 0 : 9 };
      };
      const isElseLine = (v: string): boolean => {
        return v.trim() === "{{:else}}";
      };
      const lines = p1.split("\n");
      if (lines.length === 1) {
        const hit = findElse(p1);
        if (hit.index !== -1) {
          if (type.type === "newif") return p1.substring(0, hit.index);
          if (type.type === "newif-falsy") return p1.substring(hit.index + hit.len);
        } else {
          if (type.type === "newif") return p1;
          if (type.type === "newif-falsy") return "";
        }
      }
      const elseLine = lines.findIndex(isElseLine);
      if (elseLine !== -1 && type.type === "newif") {
        lines.splice(elseLine);
      }
      if (elseLine !== -1 && type.type === "newif-falsy") {
        lines.splice(0, elseLine + 1);
      }
      if (elseLine === -1 && type.type === "newif-falsy") return "";

      if (type.type2 !== "keep") {
        while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
        while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
      }
      return lines.join("\n");
    }
    case "normalize":
      return p1Trimmed
        .replaceAll("\n", "")
        .replaceAll("\t", "")
        .replaceAll(/\\u([0-9A-Fa-f]{4})/g, (_m, p) => String.fromCharCode(parseInt(p, 16)))
        .replaceAll(/\\(.)/g, (_m, p) => {
          switch (p) {
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "b": return "\b";
            case "f": return "\f";
            case "v": return "\v";
            case "a": return "\x07";
            case "x": return "\x00";
            default: return p;
          }
        });
    case "escape":
      return risuEscape(type.mode === "keep" ? p1 : p1Trimmed);
    default:
      return "";
  }
}
