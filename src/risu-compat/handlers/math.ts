import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { parseArray, calcString } from "../risu-helpers.js";

// Math macros. Risu source: cbs.ts.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Math", scoped: false });
}

// cbs.ts.
register("round", (_c, a) => Math.round(Number(a[0])).toString(),
  "Rounds to nearest integer (half-up).");
register("floor", (_c, a) => Math.floor(Number(a[0])).toString(),
  "Floors (rounds toward negative infinity).");
register("ceil", (_c, a) => Math.ceil(Number(a[0])).toString(),
  "Ceils (rounds toward positive infinity).");
register("abs", (_c, a) => Math.abs(Number(a[0])).toString(),
  "Absolute value.");
register("remaind", (_c, a) => (Number(a[0]) % Number(a[1])).toString(),
  "Returns (a % b) as string.");
register("pow", (_c, a) => Math.pow(Number(a[0]), Number(a[1])).toString(),
  "Returns a^b.");

// cbs.ts. Accepts multiple args or a single JSON/§ array.
const aggSource = (args: readonly string[]): readonly string[] =>
  args.length > 1 ? args : (parseArray(args[0] ?? "").map((v) => String(v)));
const toNum = (s: string): number => {
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
register("min", (_c, a) => Math.min(...aggSource(a).map(toNum)).toString(),
  "Minimum of the given values (non-numeric treated as 0).");
register("max", (_c, a) => Math.max(...aggSource(a).map(toNum)).toString(),
  "Maximum of the given values.");
register("sum", (_c, a) => aggSource(a).map(toNum).reduce((x, y) => x + y, 0).toString(),
  "Sum of the given values.");
register("average", (_c, a) => {
  const src = aggSource(a);
  if (src.length === 0) return "NaN";
  return (src.map(toNum).reduce((x, y) => x + y, 0) / src.length).toString();
}, "Arithmetic mean of the given values.");

// cbs.ts (tonumber, pow), cbs.ts (fixnum).
register("tonumber", (_c, a) => {
  const s = a[0] ?? "";
  let out = "";
  for (const ch of s) {
    if (!isNaN(Number(ch)) || ch === ".") out += ch;
  }
  return out;
}, "Extracts digits (and decimal points) from the input string.");
register("fixnum", (_c, a) => Number(a[0]).toFixed(Number(a[1])).toString(),
  "Rounds to N decimal places via toFixed.");

// cbs.ts.
register("calc", (ctx, a) => {
  const expr = a[0] ?? "";
  const n = calcString(
    expr,
    (name) => ctx.vars.get("local", name),
    (name) => ctx.vars.get("global", name),
  );
  return n.toString();
}, "Evaluates a mathematical expression. Supports + - * / ^ % and comparison operators; $x reads local var, @x reads global var.");
