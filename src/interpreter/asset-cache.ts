// Per-chat asset + emotion index cache. Written on CHAT_CHANGED by backend.ts;
// Read while constructing the active in-worker evaluator context.

import type { AssetIndexEntry } from '../payload/types.js';

export interface AssetIndexes {
  /** Name (lowercased) → Lumi image descriptor for `additionalAssets`. */
  readonly assets: Readonly<Record<string, AssetIndexEntry>>;
  /** Name (lowercased) → Lumi image descriptor for emotion images. */
  readonly emotions: Readonly<Record<string, AssetIndexEntry>>;
}

const byChat = new Map<string, AssetIndexes>();

export function setActiveAssetIndexes(chatId: string, indexes: AssetIndexes): void {
  byChat.set(chatId, indexes);
}

export function clearActiveAssetIndexes(chatId: string): void {
  byChat.delete(chatId);
}

export function getActiveAssetIndexes(
  chatId: string | null | undefined,
): AssetIndexes | null {
  if (!chatId) return null;
  return byChat.get(chatId) ?? null;
}

export function resetAllAssetIndexes(): void {
  byChat.clear();
}
