import type { SpindleAPI, WorldBookEntryCreateDTO, WorldBookEntryDTO } from 'lumiverse-spindle-types';
import type { LumirealmCharacterData } from '../payload/types.js';
import { RisuCompatUnsupportedError } from '../interpreter/host.js';

const creating = new Map<string, Promise<unknown>>();

export function createCharacterLoreEntry(host: Pick<SpindleAPI, 'characters' | 'world_books'>,
  characterId: string, userId: string, entry: WorldBookEntryCreateDTO): Promise<WorldBookEntryDTO> {
  const key = JSON.stringify([userId, characterId]);
  const run = (creating.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const character = await host.characters.get(characterId, userId);
    if (!character) throw new RisuCompatUnsupportedError('createLorebook', 'current character is unavailable');
    const data = character.extensions.lumirealm as LumirealmCharacterData | undefined;
    const modules = new Set(Object.values(data?.user_overrides.attached_module_world_books ?? {}));
    let bookId = character.world_book_ids.find(id => !modules.has(id));
    if (!bookId) {
      const book = await host.world_books.create({ name: `${character.name} lore`,
        metadata: { source: 'character', source_character_id: characterId, auto_managed_by_character: true } }, userId);
      try {
        const current = await host.characters.get(characterId, userId);
        if (!current) throw new RisuCompatUnsupportedError('createLorebook', 'current character is unavailable');
        await host.characters.update(characterId, { world_book_ids: [...current.world_book_ids, book.id] }, userId);
      } catch (error) {
        await host.world_books.delete(book.id, userId);
        throw error;
      }
      bookId = book.id;
    }
    return host.world_books.entries.create(bookId, entry, userId);
  });
  creating.set(key, run);
  void run.finally(() => { if (creating.get(key) === run) creating.delete(key); }).catch(() => {});
  return run;
}
