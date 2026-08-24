// Result memo for display resolution. Mirrors render-mcp-cache.ts: version
// bump + short TTL so Lua writebacks that never surface as set_variables
// pushes still expire. FIFO cap bounds streaming churn (one key per chunk).
const DEFAULT_CAP = 64;
const TTL_MS = 5_000;

interface MemoEntry {
  version: number;
  ts: number;
  value: unknown;
}

export interface DisplayResolveMemo {
  get<T>(chatId: string, key: string): T | undefined;
  set(chatId: string, key: string, value: unknown): void;
  bump(chatId?: string): void;
  /**
   * Purge only entries whose result declared a dependency on one of `deps`.
   * Content-keyed entries for untouched messages survive, so per-token
   * streaming churn no longer wipes the whole chat's memo.
   */
  purgeDeps(chatId: string, deps: readonly string[]): void;
  size(chatId: string): number;
}

export function createDisplayResolveMemo(opts?: { cap?: number }): DisplayResolveMemo {
  const cap = opts?.cap ?? DEFAULT_CAP;
  const memos = new Map<string, Map<string, MemoEntry>>();
  const versions = new Map<string, number>();
  const MAX_CHATS = 32;
  return {
    get<T>(chatId: string, key: string): T | undefined {
      const ver = versions.get(chatId) ?? 0;
      const e = memos.get(chatId)?.get(key);
      if (!e || e.version !== ver || Date.now() - e.ts > TTL_MS) return undefined;
      return e.value as T;
    },
    set(chatId: string, key: string, value: unknown): void {
      const ver = versions.get(chatId) ?? 0;
      let m = memos.get(chatId);
      if (!m) {
        m = new Map();
        memos.set(chatId, m);
      }
      m.set(key, { version: ver, ts: Date.now(), value });
      while (m.size > cap) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
      // Bound total chats seen across a session (chat switches allocate new
      // per-chat maps; versions/entries for abandoned chats are dead weight).
      while (memos.size > MAX_CHATS) {
        const oldestChat = memos.keys().next().value;
        if (oldestChat === undefined) break;
        memos.delete(oldestChat);
        versions.delete(oldestChat);
      }
    },
    bump(chatId?: string): void {
      if (chatId === undefined) {
        versions.clear();
        memos.clear();
        return;
      }
      versions.set(chatId, (versions.get(chatId) ?? 0) + 1);
      memos.delete(chatId);
    },
    purgeDeps(chatId: string, deps: readonly string[]): void {
      if (deps.length === 0) return;
      const m = memos.get(chatId);
      if (!m) return;
      for (const [key, entry] of m) {
        const touched = (entry.value as { touchedVars?: unknown } | null | undefined)?.touchedVars;
        // Resolver results always carry touchedVars as a string array. A value
        // without that shape has unknown dependencies — purge defensively.
        const matched = !Array.isArray(touched)
          || deps.some((d) => (touched as readonly unknown[]).includes(d));
        if (matched) m.delete(key);
      }
    },
    size(chatId: string): number {
      return memos.get(chatId)?.size ?? 0;
    },
  };
}

// Module-level memo shared by the resolver created in createDisplayResolver;
// bumped from frontend.ts on identity changes and dependency-purged on
// display_snapshot / set_variables var diffs.
let shared: DisplayResolveMemo | null = null;
export function getSharedDisplayResolveMemo(): DisplayResolveMemo {
  if (!shared) shared = createDisplayResolveMemo();
  return shared;
}
export function bumpDisplayResolveMemo(chatId?: string): void {
  getSharedDisplayResolveMemo().bump(chatId);
}
export function purgeDisplayResolveMemoForDeps(chatId: string, deps: readonly string[]): void {
  getSharedDisplayResolveMemo().purgeDeps(chatId, deps);
}
