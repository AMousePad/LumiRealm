// Risu parity: process/scripts.ts processScriptCache. Identical templates
// fire 3+ times per chat-open on Cheongwon-grade cards.

import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('macro-interceptor-cache');

const TTL_MS = 5_000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  readonly result: string;
  readonly touchedVars: readonly string[];
  readonly volatile: boolean;
  readonly ts: number;
}

export interface MacroInterceptorHit {
  readonly result: string;
  readonly touchedVars: readonly string[];
  readonly volatile: boolean;
}

const cache = new Map<string, CacheEntry>();
let hitCount = 0;
let missCount = 0;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function key(chatId: string, template: string, commit: boolean, ctxKey: string): string {
  return `${chatId}::${commit ? 'c' : 'd'}::${ctxKey}::${template.length}::${fnv1a(template)}`;
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

export function lookupMacroInterceptor(
  chatId: string,
  template: string,
  commit: boolean,
  ctxKey: string,
): MacroInterceptorHit | null {
  const k = key(chatId, template, commit, ctxKey);
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
  hitCount += 1;
  return { result: entry.result, touchedVars: entry.touchedVars, volatile: entry.volatile };
}

export function cacheMacroInterceptor(
  chatId: string,
  template: string,
  commit: boolean,
  ctxKey: string,
  result: string,
  touchedVars: readonly string[],
  volatile: boolean,
): void {
  const now = Date.now();
  evictIfNeeded(now);
  cache.set(key(chatId, template, commit, ctxKey), { result, touchedVars, volatile, ts: now });
}

export function invalidateMacroInterceptorForChat(chatId: string): void {
  const prefix = `${chatId}::`;
  let removed = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) {
      cache.delete(k);
      removed += 1;
    }
  }
  if (removed > 0) log.debug(`invalidate chat=${chatId} entries=${removed}`);
}

// Dep-scoped twin of invalidateMacroInterceptorForChat: drop only entries
// whose recorded touchedVars intersect `deps`. Entries with a malformed
// touchedVars shape are purged defensively (mirrors resolve-memo.purgeDeps);
// empty arrays are static and survive.
export function invalidateMacroInterceptorForVars(chatId: string, deps: readonly string[]): void {
  if (deps.length === 0) return;
  const prefix = `${chatId}::`;
  let removed = 0;
  for (const [k, v] of cache) {
    if (!k.startsWith(prefix)) continue;
    const touched = v.touchedVars;
    const matched = !Array.isArray(touched)
      || deps.some((d) => (touched as readonly string[]).includes(d));
    if (matched) {
      cache.delete(k);
      removed += 1;
    }
  }
  if (removed > 0) log.debug(`invalidate-vars chat=${chatId} deps=${deps.length} entries=${removed}`);
}

export function resetMacroInterceptorCache(): void {
  cache.clear();
  hitCount = 0;
  missCount = 0;
}

export function macroInterceptorCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: hitCount, misses: missCount };
}

export const MACRO_INTERCEPTOR_CACHE_TTL_MS = TTL_MS;
export const MACRO_INTERCEPTOR_CACHE_MAX = MAX_ENTRIES;
