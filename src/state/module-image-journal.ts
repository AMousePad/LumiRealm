import { createImageJournal, type ImageJournal } from './image-journal-store.js';

export type ModuleImageJournalFile = ImageJournal<'moduleId'>;
const journal = createImageJournal('lumirealm/module_image_journal', 'moduleId');
export const readModuleImageJournalFile = journal.read;
export const appendModuleImageIdsToJournal = journal.append;
export const clearModuleImageJournal = journal.clear;
export const listModuleImageJournalIds = journal.list;
