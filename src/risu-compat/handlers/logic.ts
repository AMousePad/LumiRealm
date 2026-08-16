import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { parseArray } from "../risu-helpers.js";

// Logic / comparison macros. Risu source: cbs.ts, 1667-1691. Output: '1' or '0'.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Logic", scoped: false });
}

// cbs.ts.
register("equal", (_c, a) => a[0] === a[1] ? "1" : "0",
  "Returns '1' if args[0] === args[1] (string compare), else '0'.");
register("notequal", (_c, a) => a[0] !== a[1] ? "1" : "0",
  "Returns '1' if args[0] !== args[1], else '0'.");

// cbs.ts.
register("greater", (_c, a) => Number(a[0]) > Number(a[1]) ? "1" : "0",
  "Returns '1' if Number(args[0]) > Number(args[1]).");
register("less", (_c, a) => Number(a[0]) < Number(a[1]) ? "1" : "0",
  "Returns '1' if Number(args[0]) < Number(args[1]).");
register("greaterequal", (_c, a) => Number(a[0]) >= Number(a[1]) ? "1" : "0",
  "Returns '1' if Number(args[0]) >= Number(args[1]).");
register("lessequal", (_c, a) => Number(a[0]) <= Number(a[1]) ? "1" : "0",
  "Returns '1' if Number(args[0]) <= Number(args[1]).");

// cbs.ts.
register("and", (_c, a) => a[0] === "1" && a[1] === "1" ? "1" : "0",
  "Boolean AND: returns '1' if both args are the literal string '1'.");
register("or", (_c, a) => a[0] === "1" || a[1] === "1" ? "1" : "0",
  "Boolean OR: returns '1' if either arg is '1'.");
register("not", (_c, a) => a[0] === "1" ? "0" : "1",
  "Boolean NOT of a '1'/'0' value.");

// cbs.ts.
const bag = (a: readonly string[]): readonly string[] =>
  a.length > 1 ? a : parseArray(a[0] ?? "").map((v) => String(v));
register("all", (_c, a) => bag(a).every((f) => f === "1") ? "1" : "0",
  "Returns '1' if every value is the literal string '1'.");
register("any", (_c, a) => bag(a).some((f) => f === "1") ? "1" : "0",
  "Returns '1' if any value is '1'.");

// cbs.ts.
register("startswith", (_c, a) => (a[0] ?? "").startsWith(a[1] ?? "") ? "1" : "0",
  "Returns '1' if args[0] starts with args[1].");
register("endswith", (_c, a) => (a[0] ?? "").endsWith(a[1] ?? "") ? "1" : "0",
  "Returns '1' if args[0] ends with args[1].");
register("contains", (_c, a) => (a[0] ?? "").includes(a[1] ?? "") ? "1" : "0",
  "Returns '1' if args[0] contains args[1] anywhere.");

// cbs.ts.
register("iserror", (_c, a) => (a[0] ?? "").toLocaleLowerCase().startsWith("error:") ? "1" : "0",
  "Returns '1' if the argument begins with 'error:' (case-insensitive).");
