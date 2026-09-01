import { describe, expect, test } from 'bun:test';
import { createLumiInterceptors } from '../../src/interceptors/lumi-hooks.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';

describe('write-time message author routing', () => {
  test('editoutput actions skip user-created rows', async () => {
    let processor: ((ctx: unknown) => Promise<{ content?: string } | void>) | undefined;
    (globalThis as unknown as { spindle: unknown }).spindle = {
      contracts: {
        preAssemblyGenerationContext: 1,
        worldInfoActivationControl: 5,
      },
      registerMessageContentProcessor: (handler: typeof processor) => {
        processor = handler;
      },
      registerMacroInterceptor: () => {},
      registerInterceptor: () => {},
      registerContextHandler: () => {},
      registerWorldInfoInterceptor: () => {},
      worldInfo: { setInterceptorChatScope: () => {} },
      chat: {
        getMessages: async () => [
          { id: 'prior', role: 'assistant', content: 'TOKEN' },
        ],
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
    };

    const active = {
      ownerUserId: 'user',
      card: {
        character_id: 'character',
        risuPayload: {
          requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
          triggers: [],
          lua_scripts: [],
          scriptstate_defaults: {},
          at_actions: [{
            action: 'repeat_back',
            script: { in: 'TOKEN', out: '@@repeat_back end' },
            flag: 'g',
            phase: 'editoutput',
            order: 0,
          }],
        },
      },
    } as unknown as ActiveCard;

    createLumiInterceptors({
      activeCardByChat: new Map([['chat', active]]),
      lastActiveChatByUser: new Map(),
      captureUserId: () => {},
      ensureActiveCardForChat: async () => active,
      getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
      modulesByNamespaceFromCard: () => null,
      resolveReadonly: async (text: string) => text,
      resolveReadonlyMany: async (texts: readonly string[]) => [...texts],
      createReadonlyManySession: () => ({ resolve: async (texts: readonly string[]) => [...texts] }),
      runMessageVarPass: async () => {},
      runBinding: async () => ({ stopSending: false }),
      isFeDisplayAuthoritative: () => false,
      isPromptRegexAuthoritative: () => false,
      dispatchPromptRegex: async (_input: unknown, _scripts: unknown, messages: unknown[]) => ({
        ok: true,
        changed: false,
        messages,
      }),
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        debug: () => {},
      },
      errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
    } as never).registerAll();

    expect(processor).toBeDefined();
    const userResult = await processor!({
      chatId: 'chat',
      content: 'fresh',
      isUser: true,
      origin: 'create',
      userId: 'user',
    });
    const assistantResult = await processor!({
      chatId: 'chat',
      content: 'fresh',
      isUser: false,
      origin: 'create',
      userId: 'user',
    });

    expect(userResult).toBeUndefined();
    expect(assistantResult).toEqual({ content: 'freshTOKEN' });
  });
});
