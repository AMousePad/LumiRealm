import type { MacroHandler } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { makeArray } from "../risu-helpers.js";

// Chat-context macros. Risu uses 'char' for assistant role (cbs.ts); normalized to 'assistant', mapped both ways.

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, handler, description, category: "Risu / Chat", scoped: false });
}

// Serialize using Risu's role vocabulary for CBS templates that inspect .role.
function risuRole(r: "user" | "assistant" | "system"): "user" | "char" | "system" {
  return r === "assistant" ? "char" : r;
}
function toSerializableMsg(m: { role: "user" | "assistant" | "system"; content: string; createdAt: number; speaker?: string }) {
  const out: Record<string, unknown> = {
    role: risuRole(m.role),
    data: m.content,
    time: m.createdAt,
  };
  if (m.speaker) out.speaker = m.speaker;
  return out;
}

// cbs.ts.
register("lorebook", (ctx) => {
  return makeArray(ctx.lorebook.map((e) => JSON.stringify(e)));
}, "Returns all active lorebook entries as a JSON array (character + chat + module lore concatenated).");

// Risu recursively parses each msg.data with the matcherArg flags.
function evalMsg(
  ctx: import("../../core/cbs/index.js").RisuRuntimeContext,
  m: { role: "user" | "assistant" | "system"; content: string; createdAt: number; speaker?: string },
): { role: "user" | "char" | "system"; data: string; time: number; speaker?: string } {
  const data = ctx.evaluate ? ctx.evaluate(m.content) : m.content;
  const out: { role: "user" | "char" | "system"; data: string; time: number; speaker?: string } = {
    role: risuRole(m.role),
    data,
    time: m.createdAt,
  };
  if (m.speaker) out.speaker = m.speaker;
  return out;
}

register("userhistory", (ctx) => {
  const filtered = ctx.messages.all()
    .filter((m) => m.role === "user")
    .map((m) => JSON.stringify(evalMsg(ctx, m)));
  return makeArray(filtered);
}, "Returns all user messages as a JSON array, each .data recursively parsed.");

register("charhistory", (ctx) => {
  const filtered = ctx.messages.all()
    .filter((m) => m.role === "assistant")
    .map((m) => JSON.stringify(evalMsg(ctx, m)));
  return makeArray(filtered);
}, "Returns all character (assistant) messages as a JSON array, each .data recursively parsed.");

// cbs.ts.
register("history", (ctx, a) => {
  const msgs = ctx.messages.all();
  if (a.length === 0) {
    const fm = ctx.character.selectedAlternateGreetingIndex === -1
      ? ctx.character.firstMessage
      : (ctx.character.alternateGreetings[ctx.character.selectedAlternateGreetingIndex] ?? ctx.character.firstMessage);
    const head = [{
      role: "char" as const,
      data: ctx.evaluate ? ctx.evaluate(fm) : fm,
      time: 0,
    }];
    return makeArray([
      ...head,
      ...msgs.map((m) => ({
        ...toSerializableMsg(m),
        data: ctx.evaluate ? ctx.evaluate(m.content) : m.content,
      })),
    ].map((v) => JSON.stringify(v)));
  }
  const withRole = a.includes("role");
  return makeArray(msgs.map((m) => (withRole ? `${risuRole(m.role)}: ${m.content}` : m.content)));
}, "No args → full JSON history with first-greeting at index 0. With 'role' arg → array of 'role: data' strings.");

// cbs.ts.
register("previouschatlog", (ctx, a) => {
  const idx = Number(a[0]);
  const msgs = ctx.messages.all();
  return msgs[idx]?.content ?? "Out of range";
}, "Returns message[N].content, or 'Out of range' if index invalid.");

// Risu cbs() with chatID=-1 walks back from chat-end. Outside cbs: from currentMessageIndex-1.
register("previouscharchat", (ctx) => {
  const msgs = ctx.messages.all();
  const start = ctx.cbsContext
    ? msgs.length - 1
    : (ctx.currentMessageIndex !== null ? ctx.currentMessageIndex - 1 : msgs.length - 1);
  for (let i = start; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === "assistant") return m.content;
  }
  const c = ctx.character;
  return c.selectedAlternateGreetingIndex === -1
    ? c.firstMessage
    : (c.alternateGreetings[c.selectedAlternateGreetingIndex] ?? c.firstMessage);
}, "Last character (assistant) message; cbs walks from chat-end, others from currentMessageIndex-1.");

// Risu cbs() with chatID=-1 returns '' (early exit). Outside cbs: walk from currentMessageIndex-1.
register("previoususerchat", (ctx) => {
  if (ctx.cbsContext) return "";
  if (ctx.currentMessageIndex === null) return "";
  const msgs = ctx.messages.all();
  for (let i = ctx.currentMessageIndex - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === "user") return m.content;
  }
  const c = ctx.character;
  return c.selectedAlternateGreetingIndex === -1
    ? c.firstMessage
    : (c.alternateGreetings[c.selectedAlternateGreetingIndex] ?? c.firstMessage);
}, "Last user message; '' in cbs (chatID=-1 short-circuit), else walks back from currentMessageIndex-1.");

// cbs.ts.
register("lastmessage", (ctx) => {
  const last = ctx.messages.last();
  return last?.content ?? "";
}, "Content of the most recent message, regardless of role.");

// Off-by-one vs Lumi's native implementation; this uses Risu's count-1 formula.
register("lastmessageid", (ctx) => {
  const n = ctx.messages.count();
  return Math.max(-1, n - 1).toString();
}, "Index of the last message in Risu's greeting-excluded frame. Returns -1 when no messages (matches Risu cbs.ts (n-1).toString()).");

register("lastusermessage", (ctx) => {
  const m = ctx.messages.lastOf("user");
  return m?.content ?? "";
}, "Alias-style shortcut for the most recent user message. '' if none.");

register("lastcharmessage", (ctx) => {
  const m = ctx.messages.lastOf("assistant");
  return m?.content ?? "";
}, "Alias-style shortcut for the most recent character (assistant) message.");

// cbs.ts.
register("jbtoggled", (ctx) => ctx.jailbreakToggle ? "1" : "0",
  "Returns '1' when the global jailbreak toggle is on.");

// cbs.ts.
register("maxcontext", (ctx) => ctx.maxContext.toString(),
  "Returns the configured max-context length as a string.");

register("messagecount", (ctx) => ctx.messages.count().toString(),
  "Returns the total number of messages in the chat.");
