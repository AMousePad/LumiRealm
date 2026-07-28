// Per-chat full messages array, synchronously readable from the macroInterceptor
// so handlers like previous*chat and messages.count() can resolve
// against real history instead of the synthesized lastUser+lastChar pair.
// Backend pre-warms on chat-open and refreshes on MESSAGE_* events.

import type { Message } from "../core/cbs/index.js";

const cache = new Map<string, readonly Message[]>();

export function getCachedMessages(chatId: string): readonly Message[] | null {
  if (!chatId) return null;
  return cache.get(chatId) ?? null;
}

export function setCachedMessages(chatId: string, messages: readonly Message[]): void {
  if (!chatId) return;
  cache.set(chatId, messages);
}

export function invalidateCachedMessages(chatId: string): void {
  if (!chatId) return;
  cache.delete(chatId);
}

export function clearMessagesCache(): void {
  cache.clear();
}

export function _debugCacheSize(): number {
  return cache.size;
}
