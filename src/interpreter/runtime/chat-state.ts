// Persists Risu scriptstate to chat.metadata.chat_variables, the scope Lumi natively
// rehydrates into env and preserves. Keys are $-prefixed in memory, bare on disk.

import { toStr } from '../../util/coerce.js';
import { rememberRecentFlush, getRecentFlush } from '../../state/recent-flush-cache.js';
import { runChatMetadataExclusive } from '../../state/chat-metadata-queue.js';
import type { HostApi } from '../host.js';

export const VAR_STORE_KEY = 'chat_variables';

export async function loadVars(api: HostApi, chatId?: string): Promise<Record<string, string>> {
  if (chatId) {
    const cached = getRecentFlush(chatId);
    if (cached) return { ...cached };
  }
  try {
    const raw = await api.chat.getMetadata(VAR_STORE_KEY);
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out['$' + k] = toStr(v);
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveVars(api: HostApi, vars: Record<string, string>, chatId?: string): Promise<void> {
  const write = async (): Promise<void> => {
    const bare: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      bare[k.startsWith('$') ? k.slice(1) : k] = v;
    }
    await api.chat.setMetadata(VAR_STORE_KEY, bare);
    if (chatId) rememberRecentFlush(chatId, vars);
  };
  try {
    if (chatId) await runChatMetadataExclusive(chatId, write);
    else await write();
  } catch { /* ignore, chat-metadata write may not be permitted */ }
}
