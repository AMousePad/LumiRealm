import { expect, test } from 'bun:test';
import type { SpindleAPI } from 'lumiverse-spindle-types';
import { createCharacterLoreEntry } from '../../src/state/character-lorebook.js';

function fixture() {
  const character = { id: 'character', name: 'Character', world_book_ids: ['module-book'],
    extensions: { lumirealm: { user_overrides: { attached_module_world_books: { module: 'module-book' } } } } };
  const books: unknown[] = [], rows: { bookId: string; entry: unknown }[] = [], deleted: string[] = [];
  let failAttachment = false;
  const check = (userId: string) => expect(userId).toBe('owner');
  const host = {
    characters: {
      get: async (_id: string, userId: string) => { check(userId); return structuredClone(character); },
      update: async (_id: string, input: { world_book_ids: string[] }, userId: string) => {
        check(userId);
        if (failAttachment) throw new Error('Attachment failed');
        character.world_book_ids = input.world_book_ids;
        return structuredClone(character);
      },
    },
    world_books: {
      create: async (input: unknown, userId: string) => { check(userId); books.push(input); return { id: 'character-book' }; },
      delete: async (id: string, userId: string) => { check(userId); deleted.push(id); return true; },
      entries: { create: async (bookId: string, entry: Record<string, unknown>, userId: string) => {
        check(userId); rows.push({ bookId, entry }); return { ...entry, id: `entry-${rows.length}`, world_book_id: bookId };
      } },
    },
  } as unknown as Pick<SpindleAPI, 'characters' | 'world_books'>;
  return { host, character, books, rows, deleted, fail: () => { failAttachment = true; } };
}

test('concurrent first entries share a character-owned book and preserve module attachments', async () => {
  const f = fixture();
  const entries = await Promise.all(['one', 'two'].map(content => createCharacterLoreEntry(f.host, 'character', 'owner', { content })));
  expect(f.books).toEqual([{ name: 'Character lore', metadata: {
    source: 'character', source_character_id: 'character', auto_managed_by_character: true,
  } }]);
  expect(f.character.world_book_ids).toEqual(['module-book', 'character-book']);
  expect(entries.map(entry => entry.world_book_id)).toEqual(['character-book', 'character-book']);
  expect(f.rows.map(row => row.entry)).toEqual([{ content: 'one' }, { content: 'two' }]);
});

test('an existing empty character book is reused even after a module book', async () => {
  const f = fixture();
  f.character.world_book_ids.push('empty-character-book');
  await createCharacterLoreEntry(f.host, 'character', 'owner', { content: 'first' });
  expect(f.books).toEqual([]);
  expect(f.rows[0]?.bookId).toBe('empty-character-book');
});

test('failed attachment removes the unbound book and propagates the failure', async () => {
  const f = fixture(); f.fail();
  await expect(createCharacterLoreEntry(f.host, 'character', 'owner', { content: 'first' })).rejects.toThrow('Attachment failed');
  expect(f.character.world_book_ids).toEqual(['module-book']);
  expect(f.rows).toEqual([]);
  expect(f.deleted).toEqual(['character-book']);
});
