// Per-chat variable snapshot state. Deduplicates pushes via stable JSON signature (sorted keys).
// Order-insensitive: same vars in different order is not a change.

import type { VariableScopes } from "../types/messages.js";

export interface VariableSnapshotEntry {
  readonly scopes: VariableScopes;
  readonly defaults: Readonly<Record<string, string>>;
  /** Monotonic per-chat sequence; increments on every push. */
  readonly seq: number;
  /** ms-since-epoch when assembled — surfaced to UI for "Last update". */
  readonly ts: number;
}

export interface VariableApplyResult {
  /** True when the snapshot differs from the last pushed one. */
  readonly changed: boolean;
  /** Always present. Caller decides whether to push. */
  readonly entry: VariableSnapshotEntry;
}

export class VariableStateStore {
  #byChat = new Map<string, VariableSnapshotEntry>();
  #signatureByChat = new Map<string, string>();

  applySnapshot(
    chatId: string,
    scopes: VariableScopes,
    defaults: Readonly<Record<string, string>>,
  ): VariableApplyResult {
    const sig = signature(scopes, defaults);
    const existing = this.#byChat.get(chatId);
    if (existing && this.#signatureByChat.get(chatId) === sig) {
      return { changed: false, entry: existing };
    }
    const seq = (existing?.seq ?? 0) + 1;
    const entry: VariableSnapshotEntry = {
      scopes: {
        local: { ...scopes.local },
        global: { ...scopes.global },
        chat: { ...scopes.chat },
      },
      defaults: { ...defaults },
      seq,
      ts: Date.now(),
    };
    this.#byChat.set(chatId, entry);
    this.#signatureByChat.set(chatId, sig);
    return { changed: true, entry };
  }

  /** Drop state for a chat (on CHAT_DELETED / CHARACTER_DELETED). */
  clearChat(chatId: string): void {
    this.#byChat.delete(chatId);
    this.#signatureByChat.delete(chatId);
  }

  /** Read-only access for `request_variables_snapshot` replies. */
  current(chatId: string): VariableSnapshotEntry | null {
    return this.#byChat.get(chatId) ?? null;
  }

  reset(): void {
    this.#byChat.clear();
    this.#signatureByChat.clear();
  }
}

function signature(
  scopes: VariableScopes,
  defaults: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({
    l: sortedRecord(scopes.local),
    g: sortedRecord(scopes.global),
    c: sortedRecord(scopes.chat),
    d: sortedRecord(defaults),
  });
}

function sortedRecord(rec: Readonly<Record<string, string | null>>): Array<[string, string | null]> {
  const keys = Object.keys(rec).sort();
  return keys.map((k) => [k, rec[k]!]);
}
