import { afterEach, expect, test } from 'bun:test';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';

afterEach(() => { delete (globalThis as { spindle?: unknown }).spindle; });

for (const [explicit, boundId] of [[false, 'selected'], [true, 'selected'], [false, 'deleted'], [false, 'foreign']] as const) {
  test(`chat-bound main connection respects explicit override: ${explicit}, binding: ${boundId}`, async () => {
    const calls: unknown[] = [];
    const profiles = [
      { id: 'first', provider: 'openai', model: 'first-model', is_default: true },
      { id: 'selected', provider: 'google', model: 'selected-model', is_default: false },
    ];
    (globalThis as { spindle?: unknown }).spindle = {
      chats: { get: async (id: string, uid: string) => {
        expect([id, uid]).toEqual(['chat', 'owner']);
        return { metadata: { connection_profile_id: boundId, connection_model: 'chat-model' } };
      } },
      connections: {
        get: async (id: string, uid: string) => {
          expect(uid).toBe('owner');
          return profiles.find(p => p.id === id) ?? null;
        },
        list: async () => profiles,
      },
      generate: { raw: async (input: unknown) => { calls.push(input); return { content: 'synthetic' }; } },
    };
    const host = makeSpindleHost({ chatId: 'chat', characterId: 'character', userId: 'owner' });
    await host.llm!.generate({ messages: [], ...(explicit ? { connectionId: 'first' } : {}) });
    expect(calls[0]).toMatchObject({ connection_id: explicit || boundId !== 'selected' ? 'first' : 'selected',
      model: explicit || boundId !== 'selected' ? 'first-model' : 'chat-model', userId: 'owner' });
  });
}
