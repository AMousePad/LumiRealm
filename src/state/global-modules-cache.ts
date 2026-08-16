// Global module ids, synchronously readable from the runtime resolution paths.
// Backend seeds on boot and refreshes on upload / delete / global-list change.

const cache = new Map<string, readonly string[]>();

export function getGlobalModuleIds(userId: string | undefined): readonly string[] {
  if (!userId) return [];
  return cache.get(userId) ?? [];
}

export function setGlobalModuleIdsCache(userId: string | undefined, ids: readonly string[]): void {
  if (!userId) return;
  cache.set(userId, [...ids]);
}

export function clearGlobalModuleIdsCache(): void {
  cache.clear();
}
