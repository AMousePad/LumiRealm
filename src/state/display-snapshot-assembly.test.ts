import { afterEach, describe, expect, test } from 'bun:test';

import { assembleDisplaySnapshot } from './display-snapshot-assembly.js';

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('display snapshot world books', () => {
  test('keeps list arguments, result order, malformed filtering, and per-book isolation', async () => {
    const calls: Array<{ bookId: string; opts: unknown }> = [];
    (globalThis as { spindle?: unknown }).spindle = {
      characters: {
        get: async () => ({
          id: 'char-1',
          world_book_ids: ['low', 'failed', 'malformed', 'high'],
        }),
      },
      personas: { getActive: async () => null },
      chat: { getMessages: async () => [] },
      chats: { get: async () => null },
      world_books: {
        entries: {
          list: async (bookId: string, opts: unknown) => {
            calls.push({ bookId, opts });
            if (bookId === 'failed') throw new Error('denied');
            if (bookId === 'malformed') return { data: null };
            return {
              data: [{ id: `${bookId}-entry`, content: bookId, order_value: bookId === 'high' ? 9 : 1 }],
            };
          },
        },
      },
    };

    const snapshot = await assembleDisplaySnapshot(
      {
        modulesByNamespaceFromCard: () => null,
        legacyMediaFindings: () => false,
        getCompiledLibraries: () => [],
      },
      {
        card: {
          character_id: 'char-1',
          asset_index: {},
          emotion_index: {},
          risuPayload: {
            triggers: [],
            lua_scripts: [],
            at_actions: [],
            scriptstate_defaults: {},
          },
        },
      } as never,
      'chat-1',
      'user-1',
      { local: {}, global: {}, chat: {} },
    );

    expect(calls).toEqual([
      { bookId: 'low', opts: { limit: 1000, userId: 'user-1' } },
      { bookId: 'failed', opts: { limit: 1000, userId: 'user-1' } },
      { bookId: 'malformed', opts: { limit: 1000, userId: 'user-1' } },
      { bookId: 'high', opts: { limit: 1000, userId: 'user-1' } },
    ]);
    expect(snapshot.lorebookHost.map((entry) => ({
      id: entry.id,
      worldBookId: entry.worldBookId,
      orderValue: entry.orderValue,
    }))).toEqual([
      { id: 'high-entry', worldBookId: 'high', orderValue: 9 },
      { id: 'low-entry', worldBookId: 'low', orderValue: 1 },
    ]);
  });
});
