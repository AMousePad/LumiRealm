// Per-chain preload for `runListenEditChain` , fetches the chat-state
// snapshot ONCE outside the per-trigger loop and shares it across all
// triggers in the same chain. Plus a short-TTL cross-chain cache so a burst
// of render-MCP calls (e.g. 14 visible messages on chat-open with a
// listenEdit-heavy card like Mortal Realm) shares a single fetch.
//
// Risu invariant: each trigger still gets a fresh Lua VM (preserved). Only
// the *data* the Lua reads is shared. editDisplay listeners can't write
// chat state (commit:false gates writes), so the snapshot can be safely
// reused across the chain.

import type { HostApi, HostMessage, TriggerRuntimePreloaded } from './host.js';
import {
  sortLorebookEntriesBySourceOrder,
  type LorebookCache,
} from './runtime/lorebook.js';
import { loadGlobalVars, loadVars } from './runtime/chat-state.js';
import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('listenEdit.preload');

interface CachedSnapshot {
  readonly snapshot: TriggerRuntimePreloaded;
  readonly ts: number;
  readonly characterId: string | null;
}

// Module-scoped cache. Key: chatId. Short TTL so we don't serve stale data
// across chat mutations. The render-MCP burst on chat-open finishes well
// inside this window; longer TTLs risk staleness when the user sends a
// message right after the burst.
const CACHE_TTL_MS = 150;
const cache = new Map<string, CachedSnapshot>();

/**
 * Invalidate the snapshot for a specific chat. Called from backend.ts on
 * any chat-state mutation event we observe (CHAT_CHANGED, MESSAGE_*).
 */
export function invalidateListenEditPreload(chatId: string): void {
  if (cache.delete(chatId)) {
    log.debug(`invalidate chat=${chatId}`);
  }
}

/**
 * Drop everything , used on shutdown / test reset. Module-scope cache makes
 * unit tests dirty otherwise.
 */
export function resetListenEditPreloadCache(): void {
  cache.clear();
}

/**
 * Fetch the snapshot a fresh `makeRisuTriggerRuntime` call would build, with
 * the chain-burst cache layered on top.
 *
 * Returns a fully-populated TriggerRuntimePreloaded:
 *   - varsCache (loadVars)
 *   - globalVars (macro_variables.global)
 *   - messagesRaw (api.chat.getMessages , pre-frame-shift; runtime.ts owns
 *     buildRisuChatView per-trigger so each Lua sees an identical view)
 *   - lorebook (api.characters.get → api.worldInfo.entries.list)
 *
 * Each fetch is wrapped so a single field's failure doesn't poison the
 * whole snapshot , a partial preload still saves the IPCs that succeeded.
 */
export async function preloadForListenEditChain(
  api: HostApi,
  chatId: string | undefined,
  characterId: string | null | undefined,
): Promise<TriggerRuntimePreloaded> {
  // Cache lookup gated on chatId; without one we can't key.
  if (chatId) {
    const cached = cache.get(chatId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.characterId === (characterId ?? null)) {
      log.trace(`cache.hit chat=${chatId} age=${Date.now() - cached.ts}ms ` +
          `entries=${cached.snapshot.lorebook?.entries.length ?? 0} msgs=${cached.snapshot.messagesRaw?.length ?? 0}`,
      );
      return cached.snapshot;
    }
  }

  const t0 = Date.now();
  // Fetch all four in parallel , they're independent IPCs; serial fetching
  // would pay 4× wall clock for no reason. Promise.allSettled so a single
  // failure doesn't bring down the rest.
  const [varsResult, globalVarsResult, msgsResult, charResult] = await Promise.allSettled([
    loadVars(api, chatId),
    loadGlobalVars(api),
    api.chat.getMessages(),
    characterId && api.characters?.get
      ? api.characters.get(characterId)
      : Promise.resolve(null),
  ]);
  const tParallel = Date.now() - t0;

  let varsCache: Record<string, string> | undefined;
  if (varsResult.status === 'fulfilled') varsCache = varsResult.value;
  else log.warn(`loadVars failed — ${(varsResult.reason as { message?: string })?.message ?? varsResult.reason}`);

  let globalVars: Record<string, string> | undefined;
  if (globalVarsResult.status === 'fulfilled') globalVars = globalVarsResult.value;
  else log.warn(`loadGlobalVars failed — ${(globalVarsResult.reason as { message?: string })?.message ?? globalVarsResult.reason}`);

  let messagesRaw: readonly HostMessage[] | undefined;
  if (msgsResult.status === 'fulfilled') messagesRaw = msgsResult.value;
  else log.warn(`getMessages failed — ${(msgsResult.reason as { message?: string })?.message ?? msgsResult.reason}`);

  let lorebook: LorebookCache | undefined;
  if (charResult.status === 'fulfilled' && charResult.value) {
    const char = charResult.value;
    const bookIds = Array.isArray(char.worldBookIds) ? char.worldBookIds : [];
    if (bookIds.length > 0 && api.worldInfo?.entries) {
      const tLore = Date.now();
      const entries: LorebookCache['entries'] = [];
      // Per-book IPCs run in parallel for the same reason loadVars+getMessages
      // do , they're independent, so we shouldn't pay N× wall clock.
      const lists = await Promise.allSettled(
        bookIds.map((bid) =>
          api.worldInfo!.entries.list(bid, { limit: 1000 }).then((res) => ({ bid, res })),
        ),
      );
      for (const r of lists) {
        if (r.status !== 'fulfilled' || !r.value.res || !Array.isArray(r.value.res.data)) continue;
        entries.push(...sortLorebookEntriesBySourceOrder(
          r.value.res.data.map((e) => ({
            ...e,
            worldBookId: e.worldBookId || r.value.bid,
          })),
        ));
      }
      lorebook = { entries, primaryBookId: bookIds[0] ?? null };
      log.debug(`lorebook fetched chat=${chatId ?? '<none>'} books=${bookIds.length} entries=${entries.length} elapsed=${Date.now() - tLore}ms`);
    } else {
      lorebook = { entries: [], primaryBookId: bookIds[0] ?? null };
    }
  } else if (charResult.status === 'rejected') {
    log.warn(`characters.get failed — ${(charResult.reason as { message?: string })?.message ?? charResult.reason}`);
  }

  const snapshot: TriggerRuntimePreloaded = {
    ...(varsCache !== undefined ? { varsCache } : {}),
    ...(globalVars !== undefined ? { globalVars } : {}),
    ...(messagesRaw !== undefined ? { messagesRaw } : {}),
    ...(lorebook !== undefined ? { lorebook } : {}),
  };

  if (chatId) {
    cache.set(chatId, { snapshot, ts: Date.now(), characterId: characterId ?? null });
  }

  log.trace(`preload.done chat=${chatId ?? '<none>'} parallel_fetch=${tParallel}ms ` +
      `total=${Date.now() - t0}ms ` +
      `vars=${varsCache ? Object.keys(varsCache).length : '<failed>'} ` +
      `globalVars=${globalVars ? Object.keys(globalVars).length : '<failed>'} ` +
      `msgs=${messagesRaw?.length ?? '<failed>'} ` +
      `lore_entries=${lorebook?.entries.length ?? '<failed>'} ` +
      `cached=${chatId ? 'yes' : 'no'}`,
  );

  return snapshot;
}
