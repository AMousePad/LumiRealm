import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setupFrontendLua } from '../../src/frontend-lua/frontend.js';
import type { FrontendLuaOperation, FrontendLuaReply } from '../../src/frontend-lua/protocol.js';
import type { RuntimeServiceCall } from '../../src/frontend-lua/services.js';
import type { RuntimeStateDto } from '../../src/frontend-lua/state-contract.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { snapshot } from './display-lua-fixture.js';
import type { DisplaySnapshot } from '../../src/display/snapshot.js';

export async function frontendRuntime(code: string | DisplaySnapshot, invalidate: (chatId: string, keys: string[], resetScripts?: boolean) => void = () => {}) {
  const config = typeof code === 'string' ? snapshot(code) : code;
  const state: RuntimeStateDto = { revision: { epoch: 'host', sequence: 1 },
    chat: { id: config.chatId, metadata: { chat_variables: config.vars.local, macro_variables: { global: config.vars.global } } },
    character: { ...config.character, id: config.characterId, name: config.charName, first_mes: config.character.firstMessage,
      world_book_ids: [...new Set(config.lorebookHost.map(entry => entry.worldBookId))] },
    persona: { id: 'persona', name: config.userName, description: config.personaText },
    messages: config.messagesHost.map((message, index_in_chat) => ({ ...message, index_in_chat })),
    lore: config.lorebookHost.map(entry => ({ ...entry, world_book_id: entry.worldBookId, order_value: entry.orderValue })), globalVariables: config.vars.global };
  const handlers = new Map<string, (...args: any[]) => void>();
  const calls: RuntimeServiceCall[] = [];
  const replies = new Map<string, { resolve(value: unknown): void; reject(reason: unknown): void }>();
  const sessionId = '0123456789abcdef0123456789abcdef';
  let runtime!: ReturnType<typeof setupFrontendLua>;
  const ctx = { frontendSessionId: sessionId,
    events: { on(event: string, handler: (...args: any[]) => void) { handlers.set(event, handler); return () => handlers.delete(event); } },
    ui: {}, display: { setExpression() {} },
    sendToBackend(raw: unknown) {
      const message = structuredClone(raw) as RuntimeServiceCall | FrontendLuaReply;
      if (message.type === 'lua_reply') {
        const pending = replies.get(message.requestId);
        replies.delete(message.requestId);
        if (message.ok) pending?.resolve(message.value); else pending?.reject(new Error(message.error));
        return;
      }
      calls.push(message);
      queueMicrotask(() => {
        let value: unknown;
        if (message.request.kind === 'bootstrap') value = { state, snapshot: config, settings: DEFAULT_SETTINGS };
        else if (message.request.kind === 'state.write' && message.request.command.kind === 'chat.variables') {
          state.chat.metadata.chat_variables = { ...state.chat.metadata.chat_variables as object, ...message.request.command.values };
          state.revision = { ...state.revision, sequence: state.revision.sequence + 1 };
          value = { revision: state.revision, patch: { chat: state.chat } };
        } else throw new Error('Unexpected frontend runtime service: ' + message.request.kind);
        runtime.receive(structuredClone({ type: 'lua_service_reply', requestId: message.requestId, ok: true, value }));
      });
    },
  } as unknown as SpindleFrontendContext;
  runtime = setupFrontendLua(ctx, invalidate, error => { throw error; });
  await runtime.snapshot(config);
  return { runtime, config, calls,
    call(operation: FrontendLuaOperation): Promise<unknown> {
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        replies.set(requestId, { resolve, reject });
        runtime.receive({ type: 'lua_call', sessionId, requestId, chatId: config.chatId, characterId: config.characterId, operation });
      });
    },
    edit(content: string) {
      state.revision = { ...state.revision, sequence: state.revision.sequence + 1 };
      handlers.get('MESSAGE_EDITED')!({ chatId: config.chatId, message: { id: 'user-message', role: 'user', content, index_in_chat: 1 } },
        { stateRevision: state.revision });
    },
  };
}
