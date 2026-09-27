import type { HostApi, HostMessage, HostWorldInfoEntry, ScriptNS, TriggerRuntimeOpts } from '../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute } from '../../src/interpreter/lua-bridge.js';

export function makeLuaDivergenceHost() {
  const messages: HostMessage[] = [
    { id: 'greeting', role: 'assistant', content: 'Greeting', createdAt: 0 },
    { id: 'user', role: 'user', content: 'Hello', createdAt: 1700000000000 },
    { id: 'reply', role: 'assistant', content: 'Welcome', createdAt: 1700000005000 },
  ];
  const metadata: Record<string, unknown> = { chat_variables: { x: '2' } };
  const character = {
    id: 'test-character', name: 'Character', description: 'Description',
    firstMessage: 'Greeting', backgroundHTML: '<div>Background</div>', worldBookIds: ['character-book'],
  };
  const entries: HostWorldInfoEntry[] = [
    { id: 'inventory', worldBookId: 'character-book', comment: 'Inventory', key: 'item', content: 'Item {{char}}' },
    { id: 'other', worldBookId: 'character-book', comment: 'Other', key: 'other', content: 'Unrelated', disabled: true },
  ];
  const createdLore: { bookId: string; entry: Partial<HostWorldInfoEntry> }[] = [];
  const generated: unknown[] = [];
  const api: HostApi = {
    chat: {
      getChatId: () => 'test-chat',
      getMessages: async () => structuredClone(messages),
      getMetadata: async key => structuredClone(metadata[key]),
      setMetadata: async (key, value) => { metadata[key] = structuredClone(value); },
      sendMessage: async (content, options) => {
        const id = `sent-${messages.length}`;
        messages.push({ id, role: options?.role ?? 'assistant', content });
        return { id };
      },
      editMessage: async (id, content) => {
        const index = messages.findIndex(message => message.id === id);
        if (index < 0) throw new Error('Message does not exist');
        messages[index] = { ...messages[index]!, content };
      },
      deleteMessage: async id => {
        const index = messages.findIndex(message => message.id === id);
        if (index < 0) throw new Error('Message does not exist');
        messages.splice(index, 1);
      },
      inject: async () => {},
    },
    characters: {
      get: async () => structuredClone(character),
      update: async (_id, patch) => { Object.assign(character, patch); },
    },
    worldInfo: { entries: {
      list: async () => ({ data: structuredClone(entries) }),
      create: async (bookId, entry) => {
        createdLore.push({ bookId, entry: structuredClone(entry) });
        const created = { ...entry, id: `created-${createdLore.length}`, worldBookId: bookId };
        entries.push(created);
        return created;
      },
      update: async (id, patch) => {
        const index = entries.findIndex(entry => entry.id === id);
        if (index < 0) throw new Error('Lore entry does not exist');
        entries[index] = { ...entries[index]!, ...patch };
        return entries[index]!;
      },
      delete: async id => {
        const index = entries.findIndex(entry => entry.id === id);
        if (index < 0) throw new Error('Lore entry does not exist');
        entries.splice(index, 1);
      },
    } },
    llm: { generate: async request => { generated.push(request); return { content: 'Generated' }; } },
    tokens: { count: async () => 3 },
  };
  const preloaded = {
    messagesRaw: structuredClone(messages), varsCache: { $x: '2' }, globalVars: {},
    lorebook: { entries: structuredClone(entries), primaryBookId: 'character-book' },
  };
  return { api, messages, metadata, character, entries, createdLore, generated, preloaded };
}

export const divergenceLuaScriptNS: ScriptNS = {
  require: async name => {
    if (name !== 'risu-compat-lua') throw new Error(`Unexpected library: ${name}`);
    return { execute };
  },
};

export async function captureLuaRuntime(options: TriggerRuntimeOpts = {}) {
  const host = makeLuaDivergenceHost();
  let globals: Record<string, (...args: unknown[]) => unknown> = {};
  const scriptNS: ScriptNS = { require: async name => {
    if (name !== 'risu-compat-lua') throw new Error(`Unexpected library: ${name}`);
    return { execute: async (_code: string, captured: typeof globals) => { globals = captured; } };
  } };
  const runtime = await makeRisuTriggerRuntime(host.api, { characterId: 'test-character', userName: 'User' }, scriptNS, {
    chatId: 'test-chat', characterId: 'test-character', binding: 'manual', lowLevelAccess: true,
    preloaded: host.preloaded, resolveTemplate: async text => text.replaceAll('{{char}}', 'Character'),
    ...options,
  });
  await runtime.runLua('');
  const call = async (name: string, ...args: unknown[]) => {
    const fn = globals[name];
    if (!fn) throw new Error(`Lua API is missing: ${name}`);
    return await fn('test-character', ...args);
  };
  return { ...host, runtime, globals, call };
}
