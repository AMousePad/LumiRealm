// Risu triggers.ts,2364,2367. Chat-message accessors and mutators.
// Reads from messagesCache; writes through host API.

import { toStr } from '../../util/coerce.js';
import { risuRoleToLumi } from '../../util/role-coerce.js';
import { unsupported } from './unsupported.js';
import type { HostApi, HostMessage } from '../host.js';

export interface ChatState {
  readonly messagesCache: HostMessage[];
  readonly loopCounter: { value: number };
  // Risu triggers.ts systemPrompt accumulator.
  readonly additionalSysPrompt: Record<'start' | 'historyend' | 'promptend', string>;
  // Risu's `char.firstMessage`: the greeting, excluded from `chat.message[]`.
  // Risu's getFirstMessage / getCharacterLastMessage fall back to it.
  readonly firstMessage?: string | undefined;
}

export interface ChatApi {
  getMessagesTail(n: number): readonly HostMessage[];
  getMessageCount(): number;
  getLastMessage(): string;
  getMessageAtIndex(i: unknown): string;
  getLastUserMessage(): string;
  getLastCharMessage(): string;
  getFirstMessage(): string;
  impersonate(role: unknown, value: unknown): Promise<void>;
  systemPrompt(location: unknown, value: unknown): Promise<void>;
  command(value: unknown): Promise<never>;
  cutChat(start: unknown, end: unknown): Promise<void>;
  modifyChat(index: unknown, value: unknown): Promise<void>;
  updateGUI(): Promise<void>;
  updateChatAt(i: unknown): Promise<void>;
  tokenize(value: unknown): never;
  quickSearchChat(value: unknown, condition: string, depth: unknown): boolean;
}

export function makeChatApi(
  api: HostApi,
  state: ChatState,
  notifyStateChanged: (source: string) => void,
): ChatApi {
  function getMessagesTail(n: number): readonly HostMessage[] {
    return state.messagesCache.slice(Math.max(0, state.messagesCache.length - n));
  }
  function getMessageCount(): number { return state.messagesCache.length; }
  function getLastMessage(): string {
    const m = state.messagesCache[state.messagesCache.length - 1];
    return toStr(m && m.content);
  }
  function getMessageAtIndex(i: unknown): string {
    const n = Number(i);
    const pick = n >= 0 ? state.messagesCache[n] : state.messagesCache[state.messagesCache.length + n];
    return toStr(pick && pick.content);
  }
  function getLastUserMessage(): string {
    for (let i = state.messagesCache.length - 1; i >= 0; i--) {
      if (state.messagesCache[i]?.role === 'user') return toStr(state.messagesCache[i]!.content);
    }
    return '';
  }
  function getLastCharMessage(): string {
    for (let i = state.messagesCache.length - 1; i >= 0; i--) {
      if (state.messagesCache[i]?.role === 'assistant') return toStr(state.messagesCache[i]!.content);
    }
    return '';
  }
  function getFirstMessage(): string {
    // Risu v2GetFirstMessage returns char.firstMessage (the greeting), which
    // is excluded from chat.message[]. Fall back to messagesCache[0] only when
    // no greeting was present (user-first chat).
    if (state.firstMessage !== undefined) return toStr(state.firstMessage);
    return toStr(state.messagesCache[0]?.content);
  }

  async function impersonate(role: unknown, value: unknown): Promise<void> {
    // Risu V1 op + Lua impersonate API takes 'user' | 'char'. Accept Risu's
    // 'bot' alias too (mirrors spindle-host LLM bridge's accepted aliases).
    const r = risuRoleToLumi(toStr(role));
    try {
      const res = await api.chat.sendMessage(toStr(value), { role: r });
      state.messagesCache.push({
        id: (res && res.id) || String(state.messagesCache.length + 1),
        content: toStr(value),
        role: r,
      });
    } catch { /* */ }
  }

  async function systemPrompt(location: unknown, value: unknown): Promise<void> {
    const loc = location === 'start' || location === 'historyend' || location === 'promptend'
      ? location as 'start' | 'historyend' | 'promptend' : 'promptend';
    state.additionalSysPrompt[loc] += toStr(value) + '\n\n';
    try {
      state.loopCounter.value += 1;
      await api.chat.inject(
        'risu-sys-' + loc + '-' + state.loopCounter.value,
        toStr(value),
        { mode: 'context', position: loc, role: 'system' },
      );
    } catch { /* */ }
  }

  async function command(value: unknown): Promise<never> {
    void value;
    return unsupported('command', 'no host equivalent of Risu processMultiCommand; corpus usage = 2 effects');
  }

  async function cutChat(start: unknown, end: unknown): Promise<void> {
    try {
      const lo = Math.max(0, Number(start) || 0);
      const hi = Math.min(state.messagesCache.length, Number(end) || state.messagesCache.length);
      for (let i = hi - 1; i >= lo; i--) {
        if (state.messagesCache[i]) await api.chat.deleteMessage(state.messagesCache[i]!.id);
      }
      state.messagesCache.splice(lo, Math.max(0, hi - lo));
    } catch { /* */ }
  }

  async function modifyChat(index: unknown, value: unknown): Promise<void> {
    try {
      const n = Number(index);
      const realIdx = n >= 0 ? n : state.messagesCache.length + n;
      const pick = state.messagesCache[realIdx];
      if (pick) {
        await api.chat.editMessage(pick.id, toStr(value));
        state.messagesCache[realIdx] = { ...pick, content: toStr(value) };
      }
    } catch { /* */ }
  }

  async function updateGUI(): Promise<void> {
    notifyStateChanged('updateGUI');
  }
  async function updateChatAt(_i: unknown): Promise<void> {
    void _i;
    notifyStateChanged('updateChatAt');
  }

  function tokenize(value: unknown): never {
    void value;
    return unsupported('tokenize', 'requires api.llm.countTokens; corpus usage = 0 effects');
  }

  function quickSearchChat(value: unknown, condition: string, depth: unknown): boolean {
    const msgs = getMessagesTail(Math.max(1, Number(depth) || 5));
    const joined = msgs.map((m) => toStr(m.content)).join('\n').toLowerCase();
    const needle = toStr(value).toLowerCase();
    return condition === 'regex'
      ? (() => { try { return new RegExp(needle).test(joined); } catch { return joined.indexOf(needle) >= 0; } })()
      : condition === 'loose'
      ? joined.indexOf(needle) >= 0
      : joined.split(/\s+/).indexOf(needle) >= 0;
  }

  return {
    getMessagesTail, getMessageCount, getLastMessage, getMessageAtIndex,
    getLastUserMessage, getLastCharMessage, getFirstMessage,
    impersonate, systemPrompt, command, cutChat, modifyChat,
    updateGUI, updateChatAt, tokenize, quickSearchChat,
  };
}
