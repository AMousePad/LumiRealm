import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { makeArray } from "../risu-helpers.js";
import { base64ToUtf8 } from "../../util/base64.js";

// Metadata macros. Risu citations inline.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Metadata", scoped: false });
}

// cbs.ts.
register("emotionlist", (ctx) => {
  return makeArray(ctx.character.emotionImages.map((e) => e.name));
}, "JSON array of emotion image names for the current character.");

// cbs.ts.
register("assetlist", (ctx) => {
  if (ctx.character.type === "group") return "";
  return makeArray(ctx.character.additionalAssets.map((a) => a.name));
}, "JSON array of additional asset names. '' for group characters.");

// cbs.ts.
register("prefillsupported", (ctx) => {
  return ctx.aiModel.startsWith("claude") ? "1" : "0";
}, "'1' if the current AI model id starts with 'claude' (Claude supports prefill).");

register("file", (ctx, a) => {
  const visualize = ctx.visualize ?? !(ctx.cbsContext || ctx.commit);
  if (visualize) return `<br><div class="x-risu-risu-file">${a[0] ?? ""}</div><br>`;
  const content = a[1] ?? "";
  try {
    return base64ToUtf8(content);
  } catch {
    return "";
  }
}, "Shows the filename when visualization is enabled; otherwise decodes base64 content to UTF-8.");

// cbs.ts.
register("chardisplayasset", (ctx) => {
  if (!ctx.character.prebuiltAssetCommand) return makeArray([]);
  const excludes = ctx.character.prebuiltAssetExclude;
  const list = ctx.character.additionalAssets
    .filter((a) => !excludes.includes(a.src))
    .map((a) => a.name);
  return makeArray(list);
}, "JSON array of character display assets, minus the excluded set. Empty array if prebuiltAssetCommand is off.");
