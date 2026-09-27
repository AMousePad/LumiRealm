import { frontendExecutorFor } from '../../tests/helpers/frontend-executor.js';
import { basicTriggerContext } from '../../tests/helpers/trigger-runtime.js';
import { afterEach, describe, expect, test } from 'bun:test';
import type { RisuPayload } from '../core/payload/index.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import { createTriggerDispatcher } from './trigger-dispatch.js';

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('trigger dispatcher flush', () => {
  test('persists manual and button Lua chat-variable writes before returning', async () => {
    const metadataByChat = new Map<string, Record<string, unknown>>();
    (globalThis as { spindle?: unknown }).spindle = {
      chat: {
        getMessages: async () => [],
        appendMessage: async () => ({ id: 'message' }),
        updateMessage: async () => {},
        deleteMessage: async () => {},
      },
      chats: {
        get: async (chatId: string) => ({ metadata: metadataByChat.get(chatId) ?? {} }),
        update: async (chatId: string, patch: { metadata?: Record<string, unknown> }) => {
          metadataByChat.set(chatId, patch.metadata ?? {});
        },
      },
      characters: {
        get: async () => ({ id: 'character', world_book_ids: [] }),
        update: async () => {},
      },
      personas: { getActive: async () => null },
      generate: { raw: async () => ({ content: '' }) },
    };

    const lua = `
      function writeManual(id)
        setChatVar(id, "manual", "saved")
      end

      function onButtonClick(id, button)
        setChatVar(id, "button", button)
      end
    `;
    const payload = {
      triggers: [{ effect: [{ type: 'triggerlua', code: lua }] }],
      lua_scripts: [lua],
      at_actions: [],
    } as unknown as RisuPayload;
    const active = {
      card: { character_id: 'character', risuPayload: payload },
      ownerUserId: 'user',
    } as unknown as ActiveCard;
    const dispatcher = createTriggerDispatcher({
      execute: frontendExecutorFor(() => active),
      ensureActiveCardForChat: async () => active,
      refreshBgHtml: async () => {},
      refreshVariables: async () => {},
    });

    await dispatcher.dispatchManualTrigger('manual-chat', 'writeManual', 'manual-id', 'user');
    expect(metadataByChat.get('manual-chat')?.['chat_variables']).toEqual({ manual: 'saved' });

    await dispatcher.dispatchButtonClick('button-chat', 'pressed', 'button-id', 'user');
    expect(metadataByChat.get('button-chat')?.['chat_variables']).toEqual({ button: 'pressed' });
  });
});
