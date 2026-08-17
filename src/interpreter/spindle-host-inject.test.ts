import { afterEach, describe, expect, test } from 'bun:test';
import {
  pendingOwnChatChanges,
  resetOwnChatChangeTracking,
} from '../state/own-chat-change.js';
import { makeSpindleHost } from './spindle-host.js';

function harness(
  initialMetadata: Record<string, unknown>,
  updateError?: Error,
) {
  let metadata = initialMetadata;
  const calls = {
    get: [] as unknown[][],
    update: [] as unknown[][],
  };
  (globalThis as { spindle?: unknown }).spindle = {
    generate: { raw: async () => ({ content: '' }) },
    chats: {
      async get(...args: unknown[]) {
        calls.get.push(args);
        return { metadata };
      },
      async update(...args: unknown[]) {
        calls.update.push(args);
        if (updateError) throw updateError;
        metadata = (args[1] as { metadata: Record<string, unknown> }).metadata;
      },
    },
  };
  return {
    calls,
    host: makeSpindleHost({ chatId: 'chat-1', characterId: 'character-1', userId: 'user-1' }),
  };
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
  resetOwnChatChangeTracking();
});

describe('spindle host chat injection', () => {
  test('creates the pending queue from empty metadata with exact user scope', async () => {
    const { host, calls } = harness({});

    expect(await host.chat.inject('inject-1', 'content-1', {
      mode: 'context', position: 'historyend', role: 'system',
    })).toBeUndefined();

    expect(calls.get).toEqual([['chat-1', 'user-1']]);
    expect(calls.update).toEqual([[
      'chat-1',
      { metadata: {
        _risu_pending_injections: [{
          id: 'inject-1',
          content: 'content-1',
          opts: { mode: 'context', position: 'historyend', role: 'system' },
        }],
      } },
      'user-1',
    ]]);
    expect(pendingOwnChatChanges('chat-1')).toBe(1);
  });

  test('appends to the pending queue while preserving existing metadata', async () => {
    const existing = [{ id: 'existing', content: 'old' }];
    const { host, calls } = harness({ keep: 'value', _risu_pending_injections: existing });

    await host.chat.inject('inject-2', 'content-2');

    expect(calls.update[0]).toEqual([
      'chat-1',
      { metadata: {
        keep: 'value',
        _risu_pending_injections: [
          { id: 'existing', content: 'old' },
          { id: 'inject-2', content: 'content-2', opts: undefined },
        ],
      } },
      'user-1',
    ]);
    expect(existing).toEqual([{ id: 'existing', content: 'old' }]);
    expect(pendingOwnChatChanges('chat-1')).toBe(1);
  });

  test('propagates metadata update failures', async () => {
    const error = new Error('update failed');
    const { host } = harness({}, error);

    await expect(host.chat.inject('inject-3', 'content-3')).rejects.toThrow(error.message);
  });
});
