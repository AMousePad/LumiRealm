import { frontendExecutorFor } from '../helpers/frontend-executor.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';
import { describe, expect, test } from 'bun:test';
import { prepareTriggers } from '../../src/interpreter/dispatcher.js';
import { createTriggerDispatcher } from '../../src/state/trigger-dispatch.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { RisuPayload } from '../../src/core/payload/index.js';

describe('output lifecycle order', () => {
  test('stores editOutput result before structured output trigger reads chat', async () => {
    const messages = [
      { id: 'greeting', role: 'assistant', content: 'hello' },
      { id: 'user', role: 'user', content: 'go' },
      { id: 'reply', role: 'assistant', content: 'raw' },
    ];
    const writes: string[] = [];

    (globalThis as { spindle?: unknown }).spindle = {
      chat: {
        getMessages: async () => messages.map((message) => ({ ...message })),
        updateMessage: async (_chatId: string, messageId: string, patch: { content?: string }) => {
          const message = messages.find((candidate) => candidate.id === messageId);
          if (message && typeof patch.content === 'string') {
            message.content = patch.content;
            writes.push(patch.content);
          }
          return message;
        },
        appendMessage: async () => ({ id: 'new' }),
        deleteMessage: async () => {},
      },
      chats: {
        get: async () => ({ metadata: {} }),
        update: async () => {},
      },
      characters: {
        get: async () => ({ id: 'character', world_book_ids: [] }),
        update: async () => {},
      },
      // makeSpindleHost dereferences generate.raw eagerly (newest-host-only contract).
      generate: { raw: async () => ({ content: '' }) },
      personas: { getActive: async () => null },
    };

    const lua = `
      listenEdit("editOutput", function(_id, value)
        return value .. "|edit"
      end)

      function onOutput(id)
        local message = getChat(id, -1)
        setChat(id, -1, message.data .. "|output")
      end
    `;
    const payload = {
      triggers: [{
        type: 'output',
        comment: 'output ordering',
        effect: [{ type: 'triggerlua', code: lua }],
      }],
      lua_scripts: [lua],
      at_actions: [],
    } as unknown as RisuPayload;
    const compiled = prepareTriggers(payload, 'character');
    const active = {
      card: {
        character_id: 'character',
        risuPayload: payload,
      },
      ownerUserId: 'user',
    } as unknown as ActiveCard;

    const dispatcher = createTriggerDispatcher({
      execute: frontendExecutorFor(() => active),
      ensureActiveCardForChat: async () => active,
      refreshBgHtml: async () => {},
      refreshVariables: async () => {},
    });

    await dispatcher.runBinding(active, 'chat', 'output', 'user');

    expect(writes).toEqual(['raw|edit', 'raw|edit|output']);
    expect(messages.at(-1)?.content).toBe('raw|edit|output');
  });
});
