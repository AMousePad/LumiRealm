import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { parseArray, pickHashRand } from "../risu-helpers.js";

// Random / dice / pick macros. Risu source: cbs.ts.
// `random`/`roll` route through ctx.rng so tests can seed.
// `pick`/`rollp` use pickHashRand; seed approximated with character name + messages.count(), known deviation from Risu's chaId+chat.id.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Random", scoped: false });
}

// cbs.ts.
function randomPickImpl(args: readonly string[], rand: number): string {
  if (args.length === 0) return rand.toString();
  let arr: unknown[];
  if (args.length === 1) {
    const s = args[0] ?? "";
    if (s.startsWith("[") && s.endsWith("]")) {
      arr = parseArray(s);
    } else {
      arr = s.replace(/\\,/g, "\u00A7X").split(/:|,/);
    }
  } else {
    arr = [...args];
  }
  const idx = Math.floor(rand * arr.length);
  const el = arr[idx];
  return typeof el === "string" ? el.replace(/\u00A7X/g, ",") : JSON.stringify(el) ?? "";
}

register("random", (ctx, a) => randomPickImpl(a, ctx.rng.random()),
  "Random element picker. No args → returns a random [0,1) number. One arg → picks from a JSON array or a comma/colon-delimited string. Multiple args → random one.");

register("pick", (ctx, a) => {
  const seed = ctx.identity.charName + ":" + ctx.messages.count();
  const rand = pickHashRand(ctx.messages.count(), seed);
  return randomPickImpl(a, rand);
}, "Hash-deterministic pick. Same inputs at the same chat position return the same element.");

register("roll", (ctx, a) => {
  if (a.length === 0) return "1";
  const notation = (a[0] ?? "").split("d");
  let num = 1;
  let sides = 6;
  if (notation.length === 2) {
    num = Number(notation[0] || 1);
    sides = Number(notation[1] || 6);
  } else if (notation.length === 1) {
    sides = Number(notation[0]);
  }
  if (isNaN(num) || isNaN(sides) || num < 1 || sides < 1) return "NaN";
  let total = 0;
  for (let i = 0; i < num; i++) total += Math.floor(ctx.rng.random() * sides) + 1;
  return total.toString();
}, "Dice roll. XdY syntax (default 1d6). Sum of N uniform rolls.");

register("rollp", (ctx, a) => {
  if (a.length === 0) return "1";
  const notation = (a[0] ?? "").split("d");
  let num = 1;
  let sides = 6;
  if (notation.length === 2) {
    num = Number(notation[0] || 1);
    sides = Number(notation[1] || 6);
  } else if (notation.length === 1) {
    sides = Number(notation[0]);
  }
  if (isNaN(num) || isNaN(sides) || num < 1 || sides < 1) return "NaN";
  let total = 0;
  for (let i = 0; i < num; i++) {
    const cid = ctx.messages.count() + (i * 15);
    const seed = ctx.identity.charName;
    total += Math.floor(pickHashRand(cid, seed) * sides) + 1;
  }
  return total.toString();
}, "Hash-deterministic dice roll. Same chat position returns the same outcome.");

register("dice", (ctx, a) => {
  const notation = (a[0] ?? "").split("d");
  const num = Number(notation[0]);
  const sides = Number(notation[1]);
  if (isNaN(num) || isNaN(sides)) return "NaN";
  let total = 0;
  for (let i = 0; i < num; i++) total += Math.floor(ctx.rng.random() * sides) + 1;
  return total.toString();
}, "Dice roll via NdS notation. No defaults — both numbers required.");

register("randint", (ctx, a) => {
  const min = Number(a[0]);
  const max = Number(a[1]);
  if (isNaN(min) || isNaN(max)) return "NaN";
  return (Math.floor(ctx.rng.random() * (max - min + 1)) + min).toString();
}, "Uniform random integer in [min, max] (inclusive).");

register("hash", (_c, a) => {
  // cbs.ts.
  const v = pickHashRand(0, a[0] ?? "");
  return ((v * 10000000) + 1).toFixed(0).padStart(7, "0");
}, "Returns a deterministic 7-digit hash of the input string.");
