// Holds the post-saveVars var map so the next listenEdit preload skips the chat.metadata.getMetadata IPC. Entries live until invalidateRecentFlush, LRU-capped by chat count.

const MAX_CHATS = 100;
const cache = new Map<string, Record<string, string | null>>();

export function rememberRecentFlush(chatId: string, vars: Readonly<Record<string, string | null>>): void {
  if (cache.has(chatId)) cache.delete(chatId);
  cache.set(chatId, { ...vars });
  if (cache.size > MAX_CHATS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function getRecentFlush(chatId: string): Record<string, string | null> | null {
  const entry = cache.get(chatId);
  if (!entry) return null;
  cache.delete(chatId);
  cache.set(chatId, entry);
  return entry;
}

export function invalidateRecentFlush(chatId: string): void {
  cache.delete(chatId);
}

export function resetRecentFlushCache(): void {
  cache.clear();
}

export function recentFlushCacheStats(): { size: number } {
  return { size: cache.size };
}
