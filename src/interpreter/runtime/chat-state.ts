// Persists Risu scriptstate to chat.metadata.chat_variables, the scope Lumi natively
// rehydrates into env and preserves. Keys are $-prefixed in memory, bare on disk.

import { toStr } from '../../util/coerce.js';
import { rememberRecentFlush, getRecentFlush } from '../../state/recent-flush-cache.js';
import { runChatMetadataExclusive } from '../../state/chat-metadata-queue.js';
import type { HostApi } from '../host.js';

export const VAR_STORE_KEY = 'chat_variables';

export class VariablePersistenceError extends Error {
  constructor(operation: 'read' | 'write', key: string, cause: unknown) {
    super(`Could not ${operation} ${key}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'VariablePersistenceError';
  }
}

export async function loadVars(api: HostApi, chatId?: string): Promise<Record<string, string | null>> {
  if (chatId) {
    const cached = getRecentFlush(chatId);
    if (cached) return { ...cached };
  }
  try {
    const raw = await api.chat.getMetadata(VAR_STORE_KEY);
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v !== undefined) out['$' + k] = v === null ? null : toStr(v);
    }
    return out;
  } catch (cause) {
    throw new VariablePersistenceError('read', VAR_STORE_KEY, cause);
  }
}

export function parseGlobalVars(raw: unknown): Record<string, string | null> {
  if (!raw || typeof raw !== 'object') return {};
  const global = (raw as { global?: unknown }).global;
  if (!global || typeof global !== 'object') return {};
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(global as Record<string, unknown>)) {
    if (value !== undefined) out[key] = value === null ? null : toStr(value);
  }
  return out;
}

export async function loadGlobalVars(api: HostApi): Promise<Record<string, string | null>> {
  try {
    return parseGlobalVars(await api.chat.getMetadata('macro_variables'));
  } catch (cause) {
    throw new VariablePersistenceError('read', 'macro_variables', cause);
  }
}

export async function saveVars(api: HostApi, vars: Record<string, string | null>, chatId?: string): Promise<void> {
  const write = async (): Promise<void> => {
    const bare: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(vars)) {
      bare[k.startsWith('$') ? k.slice(1) : k] = v;
    }
    await api.chat.setMetadata(VAR_STORE_KEY, bare);
    if (chatId) rememberRecentFlush(chatId, vars);
  };
  try {
    if (chatId) await runChatMetadataExclusive(chatId, write);
    else await write();
  } catch (cause) {
    throw new VariablePersistenceError('write', VAR_STORE_KEY, cause);
  }
}
