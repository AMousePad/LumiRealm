import type { SpindleAPI, ChatDTO } from 'lumiverse-spindle-types';
import type { LoreBook } from '../core/schemas/lorebook.js';
import { LOCAL_LORE_KEY, readLocalLore, upsertLocalLore } from '../interpreter/runtime/local-lore.js';
import { RisuCompatUnsupportedError } from '../interpreter/host.js';
import { invalidateMacroInterceptorForChat } from './macro-interceptor-cache.js';

export interface LocalLoreHost {
  contracts: Readonly<Record<string, number>>;
  chats: Pick<SpindleAPI['chats'], 'get'> & {
    compareAndSetMetadata(chatId: string, input: { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> }, userId: string): Promise<ChatDTO | null>;
  };
}

const cached = new Map<string, { userId: string; promise: Promise<readonly LoreBook[]> }>();
export function invalidateLocalLore(chatId?: string): void { if (chatId === undefined) cached.clear(); else cached.delete(chatId); }
export function readCachedLocalLore(host: Pick<SpindleAPI, 'chats'>, chatId: string, userId: string): Promise<readonly LoreBook[]> {
  const hit = cached.get(chatId);
  if (hit?.userId === userId) return hit.promise;
  const promise = host.chats.get(chatId, userId).then(chat => {
    if (!chat) throw new RisuCompatUnsupportedError('localLore', 'current chat is unavailable');
    return readLocalLore(chat.metadata ?? {});
  });
  cached.set(chatId, { userId, promise });
  void promise.catch(() => { if (cached.get(chatId)?.promise === promise) cached.delete(chatId); });
  return promise;
}

export function persistLocalLore(host: LocalLoreHost, chatId: string, userId: string, entry: LoreBook): Promise<ChatDTO> {
  return writeLocalLore(host, chatId, userId, entries => upsertLocalLore(entries, entry));
}
export function replaceLocalLore(host: LocalLoreHost, chatId: string, userId: string, entries: readonly LoreBook[]): Promise<ChatDTO> {
  return writeLocalLore(host, chatId, userId, () => entries);
}
async function writeLocalLore(host: LocalLoreHost, chatId: string, userId: string, apply: (entries: readonly LoreBook[]) => readonly LoreBook[]): Promise<ChatDTO> {
  if (!host.contracts?.worldInfoAdditionalEntries) throw new RisuCompatUnsupportedError('upsertLocalLoreBook', 'host lacks prompt-local world info entries');
  for (let attempt = 0; attempt < 16; attempt++) {
    const chat = await host.chats.get(chatId, userId);
    if (!chat) throw new RisuCompatUnsupportedError('upsertLocalLoreBook', 'current chat is unavailable');
    const updated = await host.chats.compareAndSetMetadata(chatId, {
      expected_metadata: chat.metadata,
      metadata: { ...chat.metadata, [LOCAL_LORE_KEY]: apply(readLocalLore(chat.metadata)) },
    }, userId);
    if (updated) { invalidateLocalLore(chatId); invalidateMacroInterceptorForChat(chatId); return updated; }
  }
  throw new RisuCompatUnsupportedError('upsertLocalLoreBook', 'chat changed repeatedly during lore persistence');
}
