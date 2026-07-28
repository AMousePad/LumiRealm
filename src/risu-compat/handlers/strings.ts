import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { makeArray, parseArray } from "../risu-helpers.js";

// Risu source: cbs.ts, 1075-1099 (lower/upper/capitalize), 2120-2127 (reverse).

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Strings", scoped: false });
}

register("replace", (_c, a) => (a[0] ?? "").replaceAll(a[1] ?? "", a[2] ?? ""),
  "Replaces all occurrences of needle with replacement.");
register("split", (_c, a) => makeArray((a[0] ?? "").split(a[1] ?? "")),
  "Splits a string on the delimiter and returns a JSON array.");
register("join", (_c, a) => parseArray(a[0] ?? "").join(a[1] ?? ""),
  "Joins a JSON array using the given separator.");
register("spread", (_c, a) => parseArray(a[0] ?? "").join("::"),
  "Joins a JSON array using :: as the separator.");
register("trim", (_c, a) => (a[0] ?? "").trim(),
  "Strips leading/trailing whitespace.");
register("length", (_c, a) => (a[0] ?? "").length.toString(),
  "Returns the character length of a string.");
register("lower", (_c, a) => (a[0] ?? "").toLocaleLowerCase(),
  "Lowercases using locale-aware conversion.");
register("upper", (_c, a) => (a[0] ?? "").toLocaleUpperCase(),
  "Uppercases using locale-aware conversion.");
register("capitalize", (_c, a) => {
  const s = a[0] ?? "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}, "Uppercases only the first character.");
register("reverse", (_c, a) => [...(a[0] ?? "")].reverse().join(""),
  "Reverses a string (code-point safe via iterator).");
