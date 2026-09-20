import { v4 } from 'uuid';
import type { HostApi, HostWorldInfoEntry, TriggerRuntimeOpts } from '../interpreter/host.js';
import type { DisplaySnapshot } from '../display/snapshot.js';
import { sortLorebookEntriesBySourceOrder } from '../interpreter/runtime/lorebook.js';
import type { FrontendRuntimeState } from './state.js';
import { runtimeLore, type RuntimeService, type RuntimeSettings } from './state-contract.js';
import { createLuaTemplateParser, createTriggerTemplateParser } from '../interpreter/runtime/template.js';

export interface FrontendHostServices {
  call<T>(request: RuntimeService): Promise<T>;
  ui: NonNullable<HostApi['ui']>;
  expression(name: string): Promise<void>;
  invalidate(source?: string): void;
  synchronize(): Promise<void>;
  capture?: (event: import('../interpreter/runtime.js').AuxDebugCaptureEvent) => void;
}

export function createFrontendHost(state: FrontendRuntimeState, snapshot: () => DisplaySnapshot, settings: RuntimeSettings, services: FrontendHostServices) {
  const chatWrites = (optimistic: boolean): Pick<HostApi['chat'], 'sendMessage' | 'editMessage' | 'deleteMessage'> => ({
    async sendMessage(content, options) {
      const role = options?.role ?? 'user';
      const id = options?.messageId || v4();
      await state.write({ kind: 'message.create', id, content,
        role: role === 'sys' || role === 'system' ? 'system' : ['char', 'bot', 'assistant'].includes(role) ? 'assistant' : 'user' }, optimistic);
      return { id };
    },
    async editMessage(id, content) { await state.write({ kind: 'message.edit', id, content }, optimistic); },
    async deleteMessage(id) { await state.write({ kind: 'message.delete', id }, optimistic); },
  });
  const lorePatch = (value: Partial<HostWorldInfoEntry>): Record<string, unknown> => ({
    ...(value.key !== undefined ? { key: typeof value.key === 'string' ? [value.key] : value.key } : {}),
    ...(value.content !== undefined ? { content: value.content } : {}),
    ...(value.comment !== undefined ? { comment: value.comment } : {}),
    ...(value.orderValue !== undefined ? { order_value: value.orderValue } : {}),
    ...(value.disabled !== undefined ? { disabled: value.disabled } : {}),
    ...(value.constant !== undefined ? { constant: value.constant } : {}),
  });
  const api: HostApi = {
    chat: {
      ...chatWrites(true), getChatId: () => state.chatId,
      getMessages: async () => state.hostMessages(),
      getMetadata: async name => state.metadata(name),
      async setMetadata(name, value) {
        if (name === 'chat_variables') {
          const current = state.variables();
          state.stageVariables(Object.fromEntries(Object.entries(value as Record<string, string | null>).filter(([key, value]) => current[key] !== value)));
        } else await state.write({ kind: 'chat.metadata', key: name, value });
      },
      inject: async (id, content, options) => services.call<void>({ kind: 'chat.inject', id, content, ...(options ? { options } : {}) }),
      setExpression: services.expression,
    },
    characters: {
      get: async id => { if (id !== state.characterId) throw new Error('Character is outside the active Lua runtime'); return state.character(); },
      async update(id, patch) {
        if (id !== state.characterId) throw new Error('Character is outside the active Lua runtime');
        await state.write({ kind: 'character.update', id, patch: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.firstMessage !== undefined ? { first_mes: patch.firstMessage } : {}),
        } });
      },
      setExpression: services.expression,
    },
    personas: {
      getActive: async () => state.persona(),
      async update(id, patch) {
        await state.write({ kind: 'persona.update', id, patch: {
          ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}),
        } });
      },
    },
    worldInfo: { entries: {
      list: async bookId => ({ data: state.lore().filter(entry => entry.worldBookId === bookId) }),
      async create(bookId, entry) { return runtimeLore(await state.write({ kind: 'lore.create', bookId, patch: lorePatch(entry) }) as Parameters<typeof runtimeLore>[0]); },
      async update(id, entry) { return runtimeLore(await state.write({ kind: 'lore.update', id, patch: lorePatch(entry) }) as Parameters<typeof runtimeLore>[0]); },
      async delete(id) { await state.write({ kind: 'lore.delete', id }); },
    } },
    ui: services.ui,
    llm: { generate: request => services.call({ kind: 'llm.generate', request }), listConnections: () => services.call({ kind: 'connections.list' }) },
    tokens: { count: text => services.call({ kind: 'tokens.count', text }) },
  };
  const templateInput = () => { const value = snapshot(); return { ...value, variables: value.vars, commit: false }; };
  const read = (scope: string, name: string): string => state.variable(name, scope === 'global') ?? (scope !== 'global' ? snapshot().scriptstateDefaults[name] : undefined) ?? 'null';
  return {
    api,
    prepareRuntime(): TriggerRuntimeOpts & { chatId: string; characterId: string } {
      const snap = snapshot();
      return {
        ...settings, chatId: state.chatId, characterId: state.characterId,
        ...(services.capture ? { auxDebugCapture: (event: import('../interpreter/runtime.js').AuxDebugCaptureEvent) => {
          if (event.kind === 'request' ? settings.auxDebugCaptureRequest : settings.auxDebugCaptureResponse) services.capture!(event);
        } } : {}),
        luaChat: state.luaChat(chatWrites(false)),
        luaVariables: {
          get: (name, scope) => read(scope, name),
          set(name, value) { if (state.variable(name) === value) return; state.stageVariables({ [name]: value }); return true; },
          flush() {},
        },
        stateChanged: services.invalidate,
        luaTemplate: createLuaTemplateParser(templateInput, read),
        templateContext: async () => templateInput(),
        resolveTemplate: async text => createTriggerTemplateParser(templateInput(), read)(text),
        preloaded: {
          varsCache: Object.fromEntries(Object.entries(state.variables()).map(([name, value]) => ['$' + name, value])),
          globalVars: state.globalVariables(), scriptstateDefaults: snap.scriptstateDefaults, messagesRaw: state.hostMessages(),
          lorebook: { entries: sortLorebookEntriesBySourceOrder(state.lore()), primaryBookId: state.character().worldBookIds?.[0] ?? null },
          luaState: {
            get character() { return state.character(); }, get persona() { return state.persona(); },
            get authorsNote() { const note = state.metadata('authors_note'); return typeof note === 'string' ? note : (note as { content?: string } | null)?.content ?? ''; },
            updateCharacter: patch => api.characters.update(state.characterId, patch),
            synchronize: services.synchronize,
          },
        },
      };
    },
  };
}
