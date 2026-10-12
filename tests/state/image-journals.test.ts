import { expect, test } from 'bun:test';
import { appendImageIdsToJournal, readImageJournalFile, clearImageJournal, listImageJournalCharacterIds, type JournalStorage } from '../../src/state/image-journal.js';
import { appendModuleImageIdsToJournal, readModuleImageJournalFile, clearModuleImageJournal, listModuleImageJournalIds } from '../../src/state/module-image-journal.js';

for (const [key, directory, append, read, clear, list] of [
  ['characterId', 'image_journal', appendImageIdsToJournal, readImageJournalFile, clearImageJournal, listImageJournalCharacterIds],
  ['moduleId', 'module_image_journal', appendModuleImageIdsToJournal, readModuleImageJournalFile, clearModuleImageJournal, listModuleImageJournalIds],
] as const) {
  test(`${key} journal preserves storage shape, ordering, user scope and pending deletion`, async () => {
    const path = `lumirealm/${directory}/item.json`;
    let stored: unknown;
    let writes = 0;
    const storage: JournalStorage = {
      getJson: async <T>(actual: string, options?: { userId?: string }) => {
        expect(actual).toBe(path); expect(options?.userId).toBe('owner'); return stored as T;
      },
      setJson: async (actual, value, options) => {
        expect(actual).toBe(path); expect(options).toEqual({ userId: 'owner' }); writes++; stored = value;
      },
      delete: async (actual, userId) => { expect(actual).toBe(path); expect(userId).toBe('owner'); stored = undefined; },
      list: async (prefix, userId) => {
        expect(prefix).toBe(`lumirealm/${directory}`); expect(userId).toBe('owner'); return ['item.json', 'ignore.txt'];
      },
    };
    await append(storage, 'owner', 'item', ['b', '', 'a', 'b']);
    expect(stored).toMatchObject({ schema_version: 1, [key]: 'item', imageIds: ['b', 'a'], status: 'active', updated_at: expect.any(Number) });
    expect(await read(storage, 'owner', 'item')).toEqual(stored as never);
    await append(storage, 'owner', 'item', ['a']);
    expect(writes).toBe(1);
    stored = { ...stored as object, status: 'pending_delete' };
    await append(storage, 'owner', 'item', ['c']);
    expect(writes).toBe(1);
    expect((await read(storage, 'owner', 'item'))?.status).toBe('pending_delete');
    expect(await list(storage, 'owner')).toEqual(['item']);
    await clear(storage, 'owner', 'item');
    expect(await read(storage, 'owner', 'item')).toBeNull();
    stored = { schema_version: 2, [key]: 'item', imageIds: [], status: 'active' };
    expect(await read(storage, 'owner', 'item')).toBeNull();
  });
}
