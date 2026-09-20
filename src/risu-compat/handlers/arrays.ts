import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { parseArray, parseDict, makeArray } from "../risu-helpers.js";

// JSON array and dict helpers. Risu source: cbs.ts.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Arrays", scoped: false });
}

register("arraylength", (_c, a) => parseArray(a[0]!).length.toString(),
  "Returns the length of a JSON array.");

register("arrayshift", (_c, a) => {
  const arr = parseArray(a[0]!);
  arr.shift();
  return makeArray(arr);
}, "Removes and discards the first element.");

register("arraypop", (_c, a) => {
  const arr = parseArray(a[0]!);
  arr.pop();
  return makeArray(arr);
}, "Removes and discards the last element.");

register("arraypush", (_c, a) => {
  const arr = parseArray(a[0]!);
  arr.push(a[1]);
  return makeArray(arr);
}, "Appends a new element.");

register("arraysplice", (_c, a) => {
  const arr = parseArray(a[0]!);
  arr.splice(Number(a[1]), Number(a[2]), a[3]);
  return makeArray(arr);
}, "Risu-style splice: (array, start, deleteCount, newElement).");

register("arrayassert", (_c, a) => {
  const arr = parseArray(a[0]!);
  const idx = Number(a[1]);
  if (idx >= arr.length) arr[idx] = a[2];
  return makeArray(arr);
}, "Sets arr[idx] = value if idx is out of bounds; else leaves array unchanged.");

register("arrayelement", (_c, a) => {
  const el = parseArray(a[0]!).at(Number(a[1])) ?? "null";
  return typeof el === "object" ? JSON.stringify(el) : String(el);
}, "Returns the element at index (JSON-stringifies if object). 'null' if OOB.");

register("dictelement", (_c, a) => {
  const el = parseDict(a[0]!)[a[1]!] ?? "null";
  return typeof el === "object" ? JSON.stringify(el) : String(el);
}, "Returns dict[key] or 'null'.");

register("objectassert", (_c, a) => {
  const d = parseDict(a[0]!);
  if (!d[a[1]!]) d[a[1]!] = a[2];
  return JSON.stringify(d);
}, "Sets obj[key] = value if missing or falsy; returns JSON.");

register("element", (_c, a) => {
  // cbs.ts. Walks each successive arg as a key.
  try {
    let current: unknown = a[0] ?? "";
    for (const step of a.slice(1)) {
      const parsed = JSON.parse(current as string);
      if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) return "null";
      current = (parsed as Record<string, unknown>)[step];
      if (!current) return "null";
    }
    return String(current);
  } catch {
    return "null";
  }
}, "Walks a JSON structure by successive keys/indices. Returns 'null' if any step fails.");

// Construct an array from args.
register("makearray", (_c, a) => makeArray(a), "Creates a JSON array from the given arguments.");

register("makedict", (_c, a) => {
  const d: Record<string, string> = {};
  for (let i = 0; i + 1 < a.length; i += 2) {
    d[a[i] ?? ""] = a[i + 1] ?? "";
  }
  return JSON.stringify(d);
}, "Creates a JSON object from interleaved key-value arguments.");

// cbs.ts.
register("range", (_c, a) => {
  const arr = parseArray(a[0]!);
  const start = arr.length > 1 ? Number(arr[0]) : 0;
  const end = arr.length > 1 ? Number(arr[1]) : Number(arr[0]);
  const step = arr.length > 2 ? Number(arr[2]) : 1;
  const out: string[] = [];
  if (step !== 0) {
    for (let i = start; i < end; i += step) out.push(i.toString());
  }
  return makeArray(out);
}, "Creates a range. [n] → [0,1,…,n-1]. [a,b] → [a,…,b-1]. [a,b,s] → step s.");

// cbs.ts.
register("filter", (_c, a) => {
  const arr = parseArray(a[0]!);
  const mode = ["all", "nonempty", "unique"].indexOf(a[1] ?? "all");
  const filterType = mode === -1 ? 0 : mode;
  return makeArray(arr.filter((f, i) => {
    switch (filterType) {
      case 0: return f !== "" && i === arr.indexOf(f);
      case 1: return f !== "";
      case 2: return i === arr.indexOf(f);
      default: return true;
    }
  }));
}, "Filters an array. mode='all' (unique + nonempty), 'nonempty', or 'unique'.");
