import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { getDisplayResolutionMode, getDisplaySnapshot, setDisplaySnapshot } from './snapshot.js';

interface ChatChange {
  chat?: { id: string; character_id?: string; metadata?: {
    chat_variables?: Record<string, unknown> | null;
    macro_variables?: { global?: Record<string, unknown> | null } | null;
  } | null };
  changedFields?: string[];
}

export function createDisplayVariableMirror(
  events: Pick<SpindleFrontendContext['events'], 'on'>,
  onChange: (chatId: string, keys: string[]) => void,
) {
  const written = new Map<string, Set<string>>();
  const unsubscribe = events.on('CHAT_CHANGED', payload => {
    if (getDisplayResolutionMode() === 'off') return;
    const { chat, changedFields } = payload as ChatChange;
    if (!chat || !changedFields || !('metadata' in chat)) return;
    const snap = getDisplaySnapshot(chat.id);
    if (!snap || (chat.character_id !== undefined && chat.character_id !== snap.characterId)) return;
    const vars = { ...snap.vars };
    const changed: string[] = [];
    for (const [scope, prefix, values] of [
      ['local', 'metadata.chat_variables.', chat.metadata?.chat_variables],
      ['global', 'metadata.macro_variables.global.', chat.metadata?.macro_variables?.global],
    ] as const) {
      for (const field of changedFields) {
        if (!field.startsWith(prefix)) continue;
        const key = field.slice(prefix.length);
        // A persistence echo cannot establish freshness for a key written by display Lua.
        // Such keys retain the existing authoritative snapshot/update path.
        if (scope === 'local' && written.get(chat.id)?.has(key)) continue;
        const raw = values && Object.hasOwn(values, key) ? values[key] : undefined;
        const value = raw === undefined || raw === null ? raw : String(raw);
        const previous = Object.hasOwn(vars[scope], key) ? vars[scope][key] : undefined;
        if (previous === value) continue;
        if (value === undefined) {
          vars[scope] = { ...vars[scope] };
          delete vars[scope][key];
        }
        else vars[scope] = { ...vars[scope], [key]: value };
        changed.push(`${scope}:${key}`);
      }
    }
    // Host chat-variable dependencies use a different scope from compatibility locals.
    // Notify with compatibility keys in the same dispatch, after the snapshot is fresh.
    if (changed.length) {
      setDisplaySnapshot({ ...snap, vars });
      onChange(chat.id, changed);
    }
  });
  return {
    recordWrite(chatId: string, vars: Readonly<Record<string, string>>): void {
      const keys = written.get(chatId) ?? new Set<string>();
      for (const key of Object.keys(vars)) keys.add(key);
      written.set(chatId, keys);
    },
    dispose(): void { unsubscribe(); written.clear(); },
  };
}
