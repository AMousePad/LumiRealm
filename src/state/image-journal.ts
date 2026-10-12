import { createImageJournal, type ImageJournal } from './image-journal-store.js';
export type { JournalStorageBasic, JournalStorage, ImageJournalStatus } from './image-journal-store.js';

export type ImageJournalFile = ImageJournal<'characterId'>;
const journal = createImageJournal('lumirealm/image_journal', 'characterId');
export const readImageJournalFile = journal.read;
export const appendImageIdsToJournal = journal.append;
export const clearImageJournal = journal.clear;
export const listImageJournalCharacterIds = journal.list;
