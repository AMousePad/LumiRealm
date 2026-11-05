import { expect, test } from 'bun:test';
import { createFrontendLuaBackend, type FrontendLuaHostContract } from '../../src/frontend-lua/backend.js';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from '../../src/interceptors/lumi-hooks.js';
import { invalidateMacroInterceptorForChat } from '../../src/state/macro-interceptor-cache.js';
import { invalidateCachedMessages } from '../../src/interpreter/messages-cache.js';
import type { SpindleAPI } from 'lumiverse-spindle-types';

test('successive native lore queries resolve CBS against the latest validated frontend state', async () => {
  const saved = (globalThis as { spindle?: unknown }).spindle;
  let macro!: (ctx: any) => Promise<{ text: string }>;
  const messages = [{ id: 'greeting', content: 'Greeting', role: 'assistant', index_in_chat: 0 },
    { id: 'message', content: 'before', role: 'user', index_in_chat: 1 }];
  const replies: any[] = [];
  const ctx = { template: '{{lastmessage}}|{{previouschatlog::0}}', userId: 'owner', phase: 'prompt', commit: false,
    env: { names: { user: 'User', char: 'Character' }, character: {}, chat: { id: 'lore-cache', messageCount: 2, lastMessageId: 1 },
      system: {}, variables: { local: {}, global: {}, chat: {} }, extra: {} } };
  const host = {
    registerMacroInterceptor: (fn: typeof macro) => { macro = fn; }, registerMessageContentProcessor() {},
    registerInterceptor() {}, registerWorldInfoInterceptor() {}, registerContextHandler() {},
    chats: { get: async () => ({ metadata: {} }) }, userStorage: { getJson: async () => null },
    generate: { raw: async () => ({}) },
    contracts: { runtimeMessageMutations: 1, worldInfoAdditionalEntries: 1 },
    host: { capabilities: Object.fromEntries(['frontend-session-routing-v1', 'runtime-state-v1', 'required-context-handlers-v1', 'required-interceptors-v1'].map(name => [name, 1])) },
    runtimeState: { read: async (chatId: string, characterId: string, userId: string) => {
      expect([chatId, characterId, userId]).toEqual(['lore-cache', 'character', 'owner']); return { messages };
    } },
    world_books: { resolveForChat: async (_chatId: string, options: { userId: string }) => {
      expect(options.userId).toBe('owner'); return [{ content: (await macro(ctx)).text, role: 'system' }];
    } }, sendToFrontend: (reply: unknown) => replies.push(reply),
  } as unknown as SpindleAPI & FrontendLuaHostContract;
  (globalThis as { spindle?: unknown }).spindle = host;
  const active = { ownerUserId: 'owner', card: { character_id: 'character', risuPayload: { scriptstate_defaults: {}, extra: {} } } };
  createLumiInterceptors({ activeCardByChat: new Map([['lore-cache', active]]), captureUserId() {},
    getCachedSettingsSync: () => ({}), modulesByNamespaceFromCard: () => null,
    log: { info() {}, warn() {}, error() {}, trace() {}, debug() {} }, errMsg: String,
  } as unknown as CreateLumiInterceptorsDeps).registerAll();
  const backend = createFrontendLuaBackend(host, async () => { throw new Error('Unexpected bootstrap'); });
  try {
    const call = { type: 'lua_service', requestId: 'query', chatId: 'lore-cache', characterId: 'character', request: { kind: 'lore.resolve' } };
    await backend.receive(call, 'owner', 'session');
    expect(replies.at(-1)).toMatchObject({ ok: true, value: [{ content: 'before|before', role: 'system' }] });
    messages[1]!.content = 'after';
    await backend.receive(call, 'owner', 'session');
    expect(replies.at(-1)).toMatchObject({ ok: true, value: [{ content: 'after|after', role: 'system' }] });
  } finally {
    backend.dispose(); (globalThis as { spindle?: unknown }).spindle = saved;
    invalidateMacroInterceptorForChat('lore-cache'); invalidateCachedMessages('lore-cache');
  }
});
