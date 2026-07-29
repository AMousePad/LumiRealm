// Last-opened timestamp per character, under `lumirealm/character-recency.json`.
// Drives recency ordering in the character pickers, which would otherwise sort
// by import time and bury whatever you actually use.

import type { UserStorageLike } from '../payload/installer.js';

const PATH = 'lumirealm/character-recency.json';
const SCHEMA_VERSION = 1;
// Cap the map so a long-lived install doesn't grow it without bound. Well above
// any realistic library, and only the newest survive a trim.
const MAX_ENTRIES = 500;

export interface CharacterRecency {
  readonly schema_version: number;
  readonly seen: Readonly<Record<string, number>>;
}

const EMPTY: CharacterRecency = { schema_version: SCHEMA_VERSION, seen: {} };

export async function readCharacterRecency(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<CharacterRecency> {
  try {
    const raw = await storage.getJson<CharacterRecency>(PATH, {
      fallback: EMPTY,
      ...(userId === undefined ? {} : { userId }),
    });
    if (!raw || typeof raw !== 'object') return EMPTY;
    if (raw.schema_version !== SCHEMA_VERSION) return EMPTY;
    if (!raw.seen || typeof raw.seen !== 'object') return EMPTY;
    return raw;
  } catch {
    return EMPTY;
  }
}

export function touchRecency(
  current: CharacterRecency,
  characterId: string,
  now: number,
): CharacterRecency {
  const seen: Record<string, number> = { ...current.seen, [characterId]: now };
  const keys = Object.keys(seen);
  if (keys.length > MAX_ENTRIES) {
    const trimmed = keys
      .sort((a, b) => (seen[b] ?? 0) - (seen[a] ?? 0))
      .slice(0, MAX_ENTRIES);
    const next: Record<string, number> = {};
    for (const k of trimmed) next[k] = seen[k]!;
    return { schema_version: SCHEMA_VERSION, seen: next };
  }
  return { schema_version: SCHEMA_VERSION, seen };
}

export async function writeCharacterRecency(
  storage: UserStorageLike,
  userId: string | undefined,
  value: CharacterRecency,
): Promise<void> {
  await storage.setJson(PATH, value, {
    ...(userId === undefined ? {} : { userId }),
  });
}
