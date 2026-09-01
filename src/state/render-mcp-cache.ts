// Render-MCP no-op cache.
//
// Lumi's `useDisplayRegex` hook bumps a global `displayRegexCacheVersion`
// counter on every CHAT_CHANGED / MESSAGE_* event and re-issues
// `/api/v1/chats/:id/display-preprocess` for every visible bubble. There's
// no batching, no abort, and no per-message gating, so a heavy chat
// with 30 visible messages and a 65 KB editDisplay Lua hook burns
// 50+ seconds of CPU on identical-input → identical-output chains during
// a single streaming session.
//
// Until Lumi gains FE-side abort + per-message cache keying, mitigate
// extension-side: cache the editDisplay chain's result keyed by
// (chatId, msgId, fnv1a(content)). On cv-bump-driven re-issue with the
// same content, we replay the cached result without re-spinning fengari.
//
// Invalidated explicitly on CHAT_CHANGED / MESSAGE_* / CHAT_DELETED so a
// var change that doesn't touch raw content (Lua reads `getChatVar` and
// branches inside the hook) still re-runs the chain. The content-hash
// component handles the common content-edited case directly.
//
// LRU + TTL match the `recent-writes.ts` shape so the eviction code is
// familiar and already exercised. Numbers picked to comfortably hold one
// active chat's worth of bubbles plus a few previously-visited chats.

import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('render-mcp-cache');

const TTL_MS = 5_000;
const MAX_ENTRIES = 500;

type RenderResult =
  | { kind: 'noop' }
  | { kind: 'transformed'; content: string };

interface CacheEntry {
  readonly contentHash: number;
  readonly contentLen: number;
  readonly result: RenderResult;
  // Hash/len of the transformed output. Lumi re-invokes the render origin with
  // the prior pass's OUTPUT (display-preprocess result fed into the regex-apply
  // prepass), so a re-feed must be a passthrough (Risu runs editDisplay once).
  readonly outHash: number;
  readonly outLen: number;
  readonly ts: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, { contentHash: number; contentLen: number; promise: Promise<RenderResult> }>();

// Per-message hashes of prior editDisplay OUTPUTs, so Lumi's regex-apply
// re-feed of a preprocessed body stays a passthrough even after a var-only
// invalidation wiped the result cache. Cleared only on real content change.
const knownOutputs = new Map<string, { hashes: Set<number>; ts: number }>();
const KNOWN_OUTPUTS_MAX = 800;

let hitCount = 0;
let missCount = 0;
let inFlightHitCount = 0;

function key(chatId: string, msgId: string): string {
  return `${chatId}::${msgId}`;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function evictIfNeeded(now: number): void {
  if (cache.size < MAX_ENTRIES) return;
  for (const [k, v] of cache) {
    if (now - v.ts > TTL_MS) cache.delete(k);
  }
  if (cache.size < MAX_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of cache) {
    if (v.ts < oldestTs) {
      oldestTs = v.ts;
      oldestKey = k;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/** Look up a cached render-MCP result. Returns the cached result on a
 *  fresh content-hash match, or `null` to indicate the caller should run
 *  the editDisplay chain and call `cacheRenderMcp` after. */
export function lookupRenderMcp(
  chatId: string,
  msgId: string,
  content: string,
): RenderResult | null {
  const k = key(chatId, msgId);
  const liveHash = fnv1a(content);
  // Re-feed guard, resilient to var/dispatch invalidation: if this content is
  // a prior editDisplay output for the message, re-running would double-apply.
  const ko = knownOutputs.get(k);
  if (ko && ko.hashes.has(liveHash)) {
    hitCount += 1;
    return { kind: 'noop' };
  }
  const entry = cache.get(k);
  if (!entry) {
    missCount += 1;
    return null;
  }
  const now = Date.now();
  if (now - entry.ts > TTL_MS) {
    cache.delete(k);
    missCount += 1;
    return null;
  }
  if (entry.contentLen === content.length && entry.contentHash === liveHash) {
    hitCount += 1;
    return entry.result;
  }
  if (
    entry.result.kind === 'transformed' &&
    entry.outLen === content.length &&
    entry.outHash === liveHash
  ) {
    hitCount += 1;
    return { kind: 'noop' };
  }
  missCount += 1;
  return null;
}

export function cacheRenderMcp(
  chatId: string,
  msgId: string,
  content: string,
  result: RenderResult,
): void {
  const now = Date.now();
  evictIfNeeded(now);
  const outContent = result.kind === 'transformed' ? result.content : content;
  const k = key(chatId, msgId);
  cache.set(k, {
    contentHash: fnv1a(content),
    contentLen: content.length,
    result,
    outHash: fnv1a(outContent),
    outLen: outContent.length,
    ts: now,
  });
  if (result.kind === 'transformed') {
    if (knownOutputs.size >= KNOWN_OUTPUTS_MAX) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [kk, v] of knownOutputs) {
        if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = kk; }
      }
      if (oldestKey) knownOutputs.delete(oldestKey);
    }
    const ko = knownOutputs.get(k);
    const h = fnv1a(result.content);
    if (ko) {
      ko.hashes.add(h);
      ko.ts = now;
      // Bound per-message growth across var-driven re-renders.
      if (ko.hashes.size > 16) {
        const first = ko.hashes.values().next().value;
        if (first !== undefined) ko.hashes.delete(first);
      }
    } else {
      knownOutputs.set(k, { hashes: new Set([h]), ts: now });
    }
  }
}

/** Concurrent identical-input render-MCP requests should share one scan instead of all firing. Returns the in-flight promise on hit; caller awaits it. Returns null if no matching in-flight request, in which case caller should `markRenderMcpInFlight` before doing the work. */
export function lookupInFlightRenderMcp(
  chatId: string,
  msgId: string,
  content: string,
): Promise<RenderResult> | null {
  const entry = inFlight.get(key(chatId, msgId));
  if (!entry) return null;
  if (entry.contentLen !== content.length) return null;
  if (entry.contentHash !== fnv1a(content)) return null;
  inFlightHitCount += 1;
  return entry.promise;
}

export function markRenderMcpInFlight(
  chatId: string,
  msgId: string,
  content: string,
  promise: Promise<RenderResult>,
): void {
  const k = key(chatId, msgId);
  inFlight.set(k, { contentHash: fnv1a(content), contentLen: content.length, promise });
  promise.finally(() => {
    const cur = inFlight.get(k);
    if (cur && cur.promise === promise) inFlight.delete(k);
  });
}

export function invalidateRenderMcpForChat(chatId: string): void {
  const prefix = `${chatId}::`;
  let removed = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) {
      cache.delete(k);
      removed += 1;
    }
  }
  for (const k of inFlight.keys()) {
    if (k.startsWith(prefix)) inFlight.delete(k);
  }
  if (removed > 0) log.debug(`invalidate chat=${chatId} entries=${removed}`);
}

export function invalidateRenderMcpForMessage(chatId: string, msgId: string): void {
  const k = key(chatId, msgId);
  if (cache.delete(k)) log.debug(`invalidate chat=${chatId} msg=${msgId}`);
  inFlight.delete(k);
  // The message's content actually changed (edit/swipe/delete), so prior
  // editDisplay outputs no longer describe it. Safe to forget the re-feed set.
  knownOutputs.delete(k);
}

export function resetRenderMcpCache(): void {
  cache.clear();
  inFlight.clear();
  knownOutputs.clear();
  hitCount = 0;
  missCount = 0;
  inFlightHitCount = 0;
}

export function renderMcpCacheStats(): { size: number; hits: number; misses: number; inFlightHits: number; inFlightSize: number } {
  return { size: cache.size, hits: hitCount, misses: missCount, inFlightHits: inFlightHitCount, inFlightSize: inFlight.size };
}

export const RENDER_MCP_CACHE_TTL_MS = TTL_MS;
export const RENDER_MCP_CACHE_MAX = MAX_ENTRIES;
