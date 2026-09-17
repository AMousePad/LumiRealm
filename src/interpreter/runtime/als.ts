// Async-context-pinned alternatives to module-global mutable state, so
// concurrent dispatches for different users do not clobber each other.

import { createAls } from './als-compat.js';

export const userIdAls = createAls<string>();

export function currentUserId(): string | null {
  return userIdAls.getStore() ?? null;
}

export const inheritedVarsAls = createAls<Record<string, string | null>>();

export const triggerDepthAls = createAls<number>();

export const MAX_TRIGGER_DEPTH = 64;

export function withTriggerDepth<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const depth = (triggerDepthAls.getStore() ?? 0) + 1;
  if (depth > MAX_TRIGGER_DEPTH) {
    throw new Error(`trigger recursion exceeded max depth (${MAX_TRIGGER_DEPTH})`);
  }
  return triggerDepthAls.run(depth, fn) as Promise<T> | T;
}

export function withUserId<T>(userId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return userIdAls.run(userId, fn) as Promise<T> | T;
}

export function withInheritedVarsCache<T>(
  varsCache: Record<string, string | null>,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return inheritedVarsAls.run(varsCache, fn) as Promise<T> | T;
}
