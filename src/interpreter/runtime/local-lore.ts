import type { LoreBook } from '../../core/schemas/lorebook.js';
import { RisuCompatUnsupportedError } from '../host.js';

export const LOCAL_LORE_KEY = 'lumirealm_local_lore';

export interface LocalLoreAccess {
  selection?: LocalLoreSelection;
  /** Writes replace snapshots; callers must not mutate these arrays or entries. */
  get(): readonly LoreBook[];
  upsert(entry: LoreBook): Promise<void>;
  replace?(entries: readonly LoreBook[]): Promise<void>;
}
export interface LocalLoreFrame {
  character: readonly LoreBook[];
  chat: readonly LoreBook[];
  access: LocalLoreAccess;
  selection: LocalLoreSelection;
}
export interface LocalLoreSelection { current: LocalLoreFrame | null }
const selections = new WeakMap<LocalLoreAccess, LocalLoreSelection>();
export function createLocalLoreFrame(access: LocalLoreAccess): LocalLoreFrame {
  let selection = access.selection ?? selections.get(access);
  if (!selection) { selection = { current: null }; selections.set(access, selection); }
  const entries = access.get();
  return { character: entries, chat: entries, access, selection };
}
export function characterLocalLore(frame: LocalLoreFrame): readonly LoreBook[] {
  return frame.selection.current === frame ? frame.access.get() : frame.character;
}
export function upsertFrameLocalLore(frame: LocalLoreFrame, entry: LoreBook): Promise<void> | undefined {
  frame.character = upsertLocalLore(characterLocalLore(frame), entry);
  if (frame.selection.current === frame) return frame.access.upsert(entry);
}
export async function publishLocalLoreFrame(frame: LocalLoreFrame, source: 'character' | 'chat'): Promise<void> {
  const previous = frame.selection.current;
  const current = frame.access.get();
  if (previous) previous.character = current;
  if (source === 'character') frame.selection.current = frame;
  const entries = frame[source];
  if (frame.selection.current) frame.selection.current.character = entries;
  if (current === entries || JSON.stringify(current) === JSON.stringify(entries)) return;
  try {
    if (!frame.access.replace) throw new RisuCompatUnsupportedError('localLore', 'requires copied chat adoption');
    await frame.access.replace(entries);
  } catch (error) {
    if (source === 'character' && frame.selection.current === frame) frame.selection.current = previous;
    throw error;
  }
}

export function readLocalLore(metadata: Readonly<Record<string, unknown>>): readonly LoreBook[] {
  const value = metadata[LOCAL_LORE_KEY];
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(entry => !entry || typeof entry !== 'object')) {
    throw new RisuCompatUnsupportedError('localLore', 'invalid saved chat lore');
  }
  return value as LoreBook[];
}

export function upsertLocalLore(entries: readonly LoreBook[], entry: LoreBook): LoreBook[] {
  return [...entries.filter(previous => previous.comment !== entry.comment), entry];
}
