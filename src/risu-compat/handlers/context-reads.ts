import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { lumiRoleToRisu } from "../../util/role-coerce.js";

// Context-read macros use RisuAI's runtime names verbatim.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({
    name,
    handler,
    description,
    category: "Risu / Context",
    scoped: false,
  });
}


// Risu's character-field handlers recursively parse with the same flags.
function recurse(ctx: import("../../core/cbs/index.js").RisuRuntimeContext, field: string): string {
  return ctx.evaluate ? ctx.evaluate(field) : field;
}

register("description", (ctx) => recurse(ctx, ctx.character.description),
  "Returns the character description, recursively parsed.");

register("personality", (ctx) => recurse(ctx, ctx.character.personality),
  "Returns the character personality field, recursively parsed.");

register("scenario", (ctx) => recurse(ctx, ctx.character.scenario),
  "Returns the character scenario field, recursively parsed.");

register("persona", (ctx) => recurse(ctx, ctx.identity.personaText),
  "Returns the user persona prompt, recursively parsed.");

register("exampledialogue", (ctx) => recurse(ctx, ctx.character.exampleDialogue),
  "Returns the character's example dialogue field, recursively parsed.");

register("mainprompt", (ctx) => recurse(ctx, ctx.character.mainPrompt),
  "Returns the system/main prompt configured for the current character, recursively parsed.");

register("jb", (ctx) => recurse(ctx, ctx.character.jailbreakPrompt),
  "Returns the jailbreak prompt text, recursively parsed.");

register("globalnote", (ctx) => recurse(ctx, ctx.character.globalNote),
  "Returns the global note (system note / ujb), recursively parsed.");

register("authornote", (ctx) => recurse(ctx, ctx.character.authorsNote),
  "Returns the author's note for the current chat, recursively parsed.");


// cbs.ts.
register("model", (ctx) => ctx.aiModel,
  "Returns the id of the currently selected AI model.");

// cbs.ts.
register("axmodel", (ctx) => ctx.axModel,
  "Returns the id of the auxiliary/secondary model.");

// Risu cbs() default (no cbsConditions, chatID=-1) returns 'null'.
// Outside cbs: chatRole > firstmsg-then-'char' > chatID-then-msg.role > role > 'null'.
register("role", (ctx) => {
  if (ctx.role !== null) return lumiRoleToRisu(ctx.role);
  if (ctx.cbsContext) return "null";
  // Prompt-regex (editprocess) pass mirrors Risu: chatID=-1 / no chatRole → matcherArg.role
  // ?? 'null' (cbs.ts:684). Risu's editprocess never sets the firstmsg condition, so the
  // greeting and any role-less block resolve 'null', NOT the display-path 'char' fallback.
  if (ctx.promptRegexLiteralVars) return "null";
  if (ctx.isFirstMessage) return "char";
  return "null";
}, "Returns the role of the current message ('user', 'char'/'assistant', 'system').");

// Greeting is Risu chatID === -1. ctx.isFirstMessage is the chat-wide fallback
// for prompt-assembly / lorebook contexts that have no per-message index.
register("isfirstmsg", (ctx) => {
  if (ctx.cbsContext) return "0";
  // Prompt-regex (editprocess) pass: Risu's editprocess never threads cbsConditions.firstmsg
  // (it's a display-only condition, set in Chat/ChatBody.svelte), so {{isfirstmsg}} is always
  // '0' there — including the greeting (cbs.ts:691-697). The display path keeps its per-index
  // greeting semantics below.
  if (ctx.promptRegexLiteralVars) return "0";
  if (ctx.currentMessageIndex !== null && ctx.currentMessageIndex !== undefined) {
    return ctx.currentMessageIndex === -1 ? "1" : "0";
  }
  return ctx.isFirstMessage ? "1" : "0";
}, "Returns '1' if the current context is the first (greeting) message, '0' otherwise.");


// cbs.ts.
register("unixtime", (ctx) => Math.floor(ctx.clock.now() / 1000).toString(),
  "Returns the current unix timestamp in seconds.");

// cbs.ts. Local time, unpadded.
register("time", (ctx) => {
  const d = new Date(ctx.clock.now());
  return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
}, "Returns the current local time in H:M:S format (unpadded, matching Risu).");

// cbs.ts.
register("isotime", (ctx) => {
  const d = new Date(ctx.clock.now());
  return `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}`;
}, "Returns the current UTC time in H:M:S format.");

// cbs.ts.
register("isodate", (ctx) => {
  const d = new Date(ctx.clock.now());
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}, "Returns the current UTC date in YYYY-M-D format (month/day not zero-padded, matching Risu).");

// cbs.ts.
register("messagetime", (ctx) => {
  if (ctx.currentMessageIndex === null) return "[Cannot get time]";
  const msgs = ctx.messages.all();
  const msg = msgs[ctx.currentMessageIndex];
  if (!msg) return "[Cannot get time]";
  if (!msg.createdAt) return "[Cannot get time, message was sent in older version]";
  return new Date(msg.createdAt).toLocaleTimeString();
}, "Returns the local time the current message was sent.");

// cbs.ts.
register("messagedate", (ctx) => {
  if (ctx.currentMessageIndex === null) return "[Cannot get time]";
  const msgs = ctx.messages.all();
  const msg = msgs[ctx.currentMessageIndex];
  if (!msg) return "[Cannot get time]";
  if (!msg.createdAt) return "[Cannot get time, message was sent in older version]";
  return new Date(msg.createdAt).toLocaleDateString();
}, "Returns the local date the current message was sent.");

// cbs.ts.
register("messageunixtimearray", (ctx) => {
  const arr = ctx.messages.all().map((m) => String(m.createdAt ?? 0));
  return makeArray(arr);
}, "Returns a JSON-encoded array of all message unix timestamps (milliseconds).");

// cbs.ts.
register("idleduration", (ctx) => {
  const msgs = ctx.messages.all();
  if (msgs.length === 0) return "00:00:00";
  const last = msgs[msgs.length - 1]!;
  if (!last.createdAt) return "[Cannot get time, message was sent in older version]";
  return formatDuration(ctx.clock.now() - last.createdAt);
}, "Returns HH:MM:SS since the most recent message.");

// cbs.ts.
register("messageidleduration", (ctx) => {
  if (ctx.currentMessageIndex === null) return "[Cannot get time]";
  const msgs = ctx.messages.all();
  let pointer = ctx.currentMessageIndex;
  let message: (typeof msgs)[number] | undefined;
  let previous: (typeof msgs)[number] | undefined;
  let stage: "findLast" | "findSecondLast" = "findLast";
  while (pointer >= 0) {
    const m = msgs[pointer];
    if (m && m.role === "user") {
      if (stage === "findLast") { message = m; stage = "findSecondLast"; }
      else { previous = m; break; }
    }
    pointer--;
  }
  if (!message) return "[No user message found]";
  if (!previous) return "[No previous user message found]";
  if (!message.createdAt) return "[Cannot get time, message was sent in older version]";
  if (!previous.createdAt) return "[Cannot get time, previous message was sent in older version]";
  return formatDuration(message.createdAt - previous.createdAt);
}, "Returns HH:MM:SS between the current and the previous user message.");


// cbs.ts.
register("br", () => "\n",
  "Returns a literal newline character.");

// cbs.ts.
register("blank", () => "",
  "Returns an empty string.");


function formatDuration(ms: number): string {
  let seconds = Math.floor(ms / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  seconds = seconds % 60;
  minutes = minutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// parser.svelte.ts.
function makeArray(arr: readonly unknown[]): string {
  return JSON.stringify(arr.map((v) => {
    if (typeof v === "string") return v.replaceAll("::", "\\u003A\\u003A");
    return v;
  }));
}
