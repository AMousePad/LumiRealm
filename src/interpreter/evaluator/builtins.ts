// Lumi-native macro mirrors for names not already claimed by risu-compat handlers.

import type { MacroHandler } from "./types.js";

type RegisterFn = (name: string, handler: MacroHandler, scoped: boolean) => void;

export function registerBuiltins(register: RegisterFn): void {
  register("bot", (ctx) => ctx.identity.charName, false);

  // PUA-protected on render-MCP, but cbs's forced worker-eval can't fall back to Lumi-native to resolve them.
  register("user", (ctx) => ctx.identity.userName, false);
  register("char", (ctx) => ctx.identity.charName, false);
  register("charname", (ctx) => ctx.identity.charName, false);
  register("notchar", (ctx) => ctx.identity.userName, false);

  register("nl", () => "\n", false);
  register("n", () => "\n", false);
  register("space", () => " ", false);
  register("noop", () => "", false);
  register("note", () => "", false);

  // trim/reverse covered by risu-compat handlers.
  register("uppercase", (_ctx, a) => (a[0] ?? "").toUpperCase(), false);
  register("toupper", (_ctx, a) => (a[0] ?? "").toUpperCase(), false);
  register("lowercase", (_ctx, a) => (a[0] ?? "").toLowerCase(), false);
  register("tolower", (_ctx, a) => (a[0] ?? "").toLowerCase(), false);

  register("charjailbreak", (ctx) => ctx.character.jailbreakPrompt ?? "", false);
}
