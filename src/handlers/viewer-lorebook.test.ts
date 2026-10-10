import { describe, expect, test } from 'bun:test';
import type { ViewerData, BackendToFrontend } from '../types/messages.js';
import { createViewerHandlers, type ViewerHandlerDeps } from './viewer.js';

const viewerData: ViewerData = {
  source: { kind: 'character', characterId: 'character-1', name: 'Card' },
  lorebook: [{
    groupName: 'Card Lore',
    groupId: 'book-1',
    entries: [{ id: 'entry-1', key: ['key'], content: 'Lore' }],
  }],
  regex: [],
  triggers: [],
  assets: [],
  cjs: null,
  backgroundHtml: null,
  defaultVariablesText: '',
  defaultVariablesUserEdited: false,
  ts: 1,
  fetchWarnings: [],
};

function build(options: { readonly liveWorldBookId?: string } = {}) {
  const sent: BackendToFrontend[] = [];
  const updates: Array<{ entryId: string; disabled: boolean; userId: string }> = [];
  const deps = {
    blockedByRepair: () => false,
    viewerAssembly: {
      assembleCharacter: async () => viewerData,
      assembleModule: async () => null,
    },
    getWorldBookEntry: async () => ({ world_book_id: options.liveWorldBookId ?? 'book-1' }),
    updateWorldBookEntry: async (entryId: string, input: { disabled: boolean }, userId: string) => {
      updates.push({ entryId, disabled: input.disabled, userId });
    },
    log: { info: () => {}, warn: () => {} },
    errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
  } as unknown as ViewerHandlerDeps;
  const handlers = createViewerHandlers(deps);
  const ctx = {
    userId: 'user-1',
    send: (message: BackendToFrontend) => { sent.push(message); },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: deps.errMsg,
  };
  return { handlers, ctx, sent, updates };
}

describe('Viewer Lore actions', () => {
  test('updates only disabled after verifying the source, book, and live entry', async () => {
    const { handlers, ctx, sent, updates } = build();

    await handlers.set_viewer_lorebook_entry_disabled({
      type: 'set_viewer_lorebook_entry_disabled',
      source: { kind: 'character', characterId: 'character-1' },
      worldBookId: 'book-1',
      entryId: 'entry-1',
      disabled: true,
    }, ctx);

    expect(updates).toEqual([{ entryId: 'entry-1', disabled: true, userId: 'user-1' }]);
    expect(sent).toEqual([{
      type: 'viewer_lorebook_entry_disabled_result',
      source: { kind: 'character', characterId: 'character-1' },
      worldBookId: 'book-1',
      entryId: 'entry-1',
      disabled: true,
      ok: true,
    }]);
  });

  test('rejects an entry that moved to a different live lorebook', async () => {
    const { handlers, ctx, sent, updates } = build({ liveWorldBookId: 'book-2' });

    await handlers.set_viewer_lorebook_entry_disabled({
      type: 'set_viewer_lorebook_entry_disabled',
      source: { kind: 'character', characterId: 'character-1' },
      worldBookId: 'book-1',
      entryId: 'entry-1',
      disabled: true,
    }, ctx);

    expect(updates).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'viewer_lorebook_entry_disabled_result',
      worldBookId: 'book-1',
      entryId: 'entry-1',
      disabled: true,
      ok: false,
    });
  });
});
