// Per-character active-lorebook cache. Written on ensureActiveCardForChat;
// read by the macro runtime so {{lorebook}} resolves to real entries.
// Keyed by characterId (all chats of a character share the same world books);
// secondary chatId index for callers that only have a chatId.

import type { LorebookEntry } from "../core/cbs/runtime/context.js";

export interface CachedLorebook { character: readonly LorebookEntry[]; modules: readonly LorebookEntry[] }
const byCharacter = new Map<string, CachedLorebook & { combined: readonly LorebookEntry[] }>();
const chatToCharacter = new Map<string, string>();

export function setActiveLorebook(
  chatId: string,
  characterId: string,
  entries: CachedLorebook,
): void {
  byCharacter.set(characterId, { ...entries, combined: [...entries.character, ...entries.modules] });
  chatToCharacter.set(chatId, characterId);
}

export function getActiveLorebook(
  chatId: string | null | undefined,
  local: readonly LorebookEntry[] = [],
): readonly LorebookEntry[] {
  if (!chatId) return [];
  const characterId = chatToCharacter.get(chatId);
  if (!characterId) return [];
  const cached = byCharacter.get(characterId);
  return cached ? local.length ? [...cached.character, ...local, ...cached.modules] : cached.combined : local;
}

export function getActiveLorebookByCharacter(
  characterId: string | null | undefined,
): CachedLorebook {
  return (characterId && byCharacter.get(characterId)) || { character: [], modules: [] };
}

export function hasActiveLorebookForCharacter(characterId: string): boolean {
  return byCharacter.has(characterId);
}

export function clearActiveLorebook(chatId: string): void {
  chatToCharacter.delete(chatId);
}

export function clearActiveLorebookForCharacter(characterId: string): void {
  byCharacter.delete(characterId);
}

export function resetAllActiveLorebook(): void {
  byCharacter.clear();
  chatToCharacter.clear();
}
