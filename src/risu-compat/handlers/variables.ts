import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";

// Variable accessors. Risu source: cbs.ts.
// `getvar`/`setvar`/`addvar` use scope "local"; `getglobalvar` uses "global"; temp vars use "temp".
// Mutations always run; no dry-parse mode in this model.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Variables", scoped: false });
}

// Exact Risu mode model for setvar/addvar/setdefaultvar (cbs.ts): rmVar (chat
// display) hides without executing, runVar (runCurrentChatFunction) executes,
// every other pass returns null so the parser re-emits the macro LITERAL.
type SetvarMode = "hide" | "run" | "literal";
function setvarMode(ctx: { rmVar?: boolean; runVar?: boolean }): SetvarMode {
  if (ctx.rmVar) return "hide";
  if (ctx.runVar) return "run";
  return "literal";
}

// Legacy gate for the non-Risu extras (deletevar/flushvar/setchatvar): these
// are our own trigger-support surface, they execute on commit as before.
function leaveVarLiteral(ctx: { commit: boolean; promptRegexLiteralVars?: boolean }): boolean {
  return !ctx.commit || ctx.promptRegexLiteralVars === true;
}

// cbs.ts.
register("getvar", (ctx, a) => ctx.vars.get("local", a[0] ?? ""),
  "Reads a local chat variable. Empty string if unset.");

register("setvar", (ctx, a) => {
  const mode = setvarMode(ctx);
  if (mode === "hide") return "";
  if (mode === "literal") return `{{setvar::${(a[0] ?? "")}::${(a[1] ?? "")}}}`;
  ctx.vars.set("local", a[0] ?? "", a[1] ?? "");
  return "";
}, "Sets a local chat variable.");

register("addvar", (ctx, a) => {
  const mode = setvarMode(ctx);
  if (mode === "hide") return "";
  if (mode === "literal") return `{{addvar::${(a[0] ?? "")}::${(a[1] ?? "")}}}`;
  // Risu passes args[1] raw to Number, a missing arg adds NaN.
  ctx.vars.add("local", a[0] ?? "", Number(a[1]));
  return "";
}, "Adds delta to a local chat variable (coerces current value to number).");

register("setdefaultvar", (ctx, a) => {
  const mode = setvarMode(ctx);
  if (mode === "hide") return "";
  if (mode === "literal") return `{{setdefaultvar::${(a[0] ?? "")}::${(a[1] ?? "")}}}`;
  // Risu cbs.ts: missing variables read as the literal "null", which
  // setdefaultvar explicitly treats as unset alongside an empty value.
  const name = a[0] ?? "";
  const current = ctx.vars.get("local", name);
  if (!current || current === "null") {
    ctx.vars.set("local", name, a[1] ?? "");
  }
  return "";
}, "Sets a local chat variable only if its current value is the empty string (Risu falsy check).");

// cbs.ts.
register("getglobalvar", (ctx, a) => ctx.vars.get("global", a[0] ?? ""),
  "Reads a global chat variable.");

// cbs.ts. Per-parser-run scope in Risu; backed by "temp" scope here.
register("tempvar", (ctx, a) => ctx.vars.get("temp", a[0] ?? ""),
  "Reads a temporary variable (per-evaluation scope).");

register("settempvar", (ctx, a) => {
  ctx.vars.set("temp", a[0] ?? "", a[1] ?? "");
  return "";
}, "Sets a temporary variable.");

// Risu exposes flushvar mainly via triggers; registering here for parity.
// Not in Risu cbs.ts → matcher returns null in cbs context → emit literal.
register("deletevar", (ctx, a) => {
  if (leaveVarLiteral(ctx)) return `{{deletevar::${(a[0] ?? "")}}}`;
  ctx.vars.delete("local", a[0] ?? "");
  return "";
}, "Deletes a local chat variable.");
register("flushvar", (ctx, a) => {
  if (leaveVarLiteral(ctx)) return `{{flushvar::${(a[0] ?? "")}}}`;
  ctx.vars.delete("local", a[0] ?? "");
  return "";
}, "Alias of deletevar.");

// Risu chat-scoped variable aliases.
register("getchatvar", (ctx, a) => ctx.vars.get("local", a[0] ?? ""),
  "Reads a chat-scoped variable (aliased to local in Risu).");
register("setchatvar", (ctx, a) => {
  if (leaveVarLiteral(ctx)) return `{{setchatvar::${(a[0] ?? "")}::${(a[1] ?? "")}}}`;
  ctx.vars.set("local", a[0] ?? "", a[1] ?? "");
  return "";
}, "Sets a chat-scoped variable.");

// Risu cbs.ts: writes __force_return__/__return__ to tempvar so parser short-circuits on next macro. Scanner check at leaf-dispatch site mirrors parser.svelte.ts.
register("return", (ctx, a) => {
  ctx.vars.set("temp", "__force_return__", "1");
  ctx.vars.set("temp", "__return__", a[0] ?? "");
  return "";
}, "Halts further macro resolution, returns the given value as the entire parser output (Risu parity).");
