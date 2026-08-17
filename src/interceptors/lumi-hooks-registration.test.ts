import { afterEach, describe, expect, test } from 'bun:test';
import type {
  InterceptorContextDTO,
  InterceptorHandler,
  LlmMessageDTO,
} from 'lumiverse-spindle-types';
import type { ActiveCard } from '../interpreter/dispatch.js';
import {
  createLumiInterceptors,
  type CreateLumiInterceptorsDeps,
} from './lumi-hooks.js';

describe('createLumiInterceptors registration', () => {
  afterEach(() => {
    delete (globalThis as { spindle?: unknown }).spindle;
  });

  test('registers every current hook without contract metadata and preserves context behavior', async () => {
    const calls: Array<{ name: string; priority: number | undefined; options?: unknown }> = [];
    const bindings: string[] = [];
    const ensureCalls: Array<{ chatId: string; characterId: string | null; userId: string }> = [];
    const messageVarCalls: string[] = [];
    let contextHandler: ((context: unknown) => Promise<unknown>) | null = null;
    let interceptor: InterceptorHandler | null = null;
    (globalThis as { spindle?: unknown }).spindle = {
      registerMacroInterceptor(_handler: unknown, priority?: number) {
        calls.push({ name: 'macro', priority });
      },
      registerMessageContentProcessor(_handler: unknown, priority?: number) {
        calls.push({ name: 'message', priority });
      },
      registerInterceptor(handler: InterceptorHandler, priority?: number) {
        interceptor = handler;
        calls.push({ name: 'prompt', priority });
      },
      registerWorldInfoInterceptor(_handler: unknown, priority?: number) {
        calls.push({ name: 'worldInfo', priority });
      },
      registerContextHandler(handler: (context: unknown) => Promise<unknown>, priority?: number, options?: unknown) {
        contextHandler = handler;
        calls.push({ name: 'context', priority, options });
      },
      generate: { raw: async () => ({ content: '' }) },
    };
    const activeCardByChat = new Map();
    const deps = {
      activeCardByChat,
      ensureActiveCardForChat: async (
        chatId: string,
        characterId: string | null,
        userId: string,
      ) => {
        ensureCalls.push({ chatId, characterId, userId });
        return null;
      },
      isPromptRegexAuthoritative: () => false,
      runMessageVarPass: async (_chatId: string, _characterId: string, userId: string) => {
        messageVarCalls.push(userId);
      },
      runBinding: async (_active: unknown, _chatId: string, binding: 'input' | 'start') => {
        bindings.push(binding);
        return { stopSending: binding === 'start' };
      },
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        debug: () => {},
      },
      errMsg: String,
    } as unknown as CreateLumiInterceptorsDeps;

    createLumiInterceptors(deps).registerAll();

    expect(calls).toEqual([
      { name: 'macro', priority: 100 },
      { name: 'message', priority: 100 },
      { name: 'prompt', priority: 100 },
      { name: 'worldInfo', priority: 100 },
      { name: 'context', priority: 100, options: { timeoutMs: 30_000 } },
    ]);

    const malformed = { dryRun: false };
    expect(await contextHandler!(malformed)).toBe(malformed);
    const dryRun = { chatId: 'chat-1', userId: 'user-1', generationType: 'normal', dryRun: true };
    expect(await contextHandler!(dryRun)).toBe(dryRun);
    expect(bindings).toEqual([]);

    activeCardByChat.set('chat-1', { ownerUserId: 'user-1' } as never);
    const live = { chatId: 'chat-1', userId: 'user-1', generationType: 'normal', dryRun: false };
    expect(await contextHandler!(live)).toEqual({ ...live, cancelGeneration: true });
    expect(bindings).toEqual(['input', 'start']);

    const currentContext = {
      userId: 'context-user',
      chatId: 'cold-chat',
      generationId: 'generation',
      generationType: 'normal',
      isDryRun: false,
      presetId: null,
      presetMetadata: null,
      personaId: null,
      characterId: 'context-character',
      personaAddonStates: {},
      mainDispatch: {
        source: 'main',
        descriptor: null,
        connectionDispatchRevision: null,
        dispatchKind: null,
      },
      prefillCarrier: { id: 'prefill', state: 'absent' },
      interceptorDeadlineAt: Date.now() + 1000,
      boundWorkDeadlineAt: Date.now() + 1000,
      signal: new AbortController().signal,
    } satisfies InterceptorContextDTO;
    const coldMessages: LlmMessageDTO[] = [{ role: 'user', content: 'cold' }];
    expect(await interceptor!(coldMessages, currentContext)).toBe(coldMessages);
    expect(ensureCalls).toEqual([{
      chatId: 'cold-chat',
      characterId: 'context-character',
      userId: 'context-user',
    }]);

    const warmActive = {
      ownerUserId: 'context-user',
      card: {
        character_id: 'warm-character',
        risuPayload: {
          triggers: [{ type: 'manual', effect: [{ type: 'triggerlua' }] }],
          lua_scripts: [''],
          extra: {},
        },
      },
    } as unknown as ActiveCard;
    activeCardByChat.set('warm-chat', warmActive);
    const warmContext = { ...currentContext, chatId: 'warm-chat', characterId: null };
    const warmMessage = {
      role: 'user',
      content: 'Hello {{setvar::hp::100}}world',
      reasoning_content: 'reasoning',
      sourceMessageId: 'source',
    } satisfies LlmMessageDTO;
    expect(await interceptor!([warmMessage], warmContext)).toEqual([{
      ...warmMessage,
      content: 'Hello world',
    }]);
    expect(ensureCalls).toHaveLength(1);
    expect(messageVarCalls).toEqual(['context-user']);

    const image = { type: 'image', data: 'image-data', mime_type: 'image/png' } as const;
    const multipartMessage: LlmMessageDTO = {
      role: 'user',
      content: [{ type: 'text', text: 'multipart' }, image],
      reasoning_content: 'kept',
      sourceMessageId: 'multipart-source',
    };
    const multipartResult = await interceptor!([multipartMessage], warmContext);
    expect(Array.isArray(multipartResult)).toBe(true);
    const multipartMessages = multipartResult as LlmMessageDTO[];
    expect(multipartMessages[0]).toBe(multipartMessage);
    expect(multipartMessages[0]!.content).toBe(multipartMessage.content);
    expect(messageVarCalls).toEqual(['context-user', 'context-user']);

    activeCardByChat.set('foreign-chat', {
      ...warmActive,
      ownerUserId: 'different-user',
    });
    const foreignMessages: LlmMessageDTO[] = [{ role: 'user', content: 'foreign' }];
    expect(await interceptor!(
      foreignMessages,
      { ...currentContext, chatId: 'foreign-chat', characterId: null },
    )).toBe(foreignMessages);
    expect(ensureCalls).toHaveLength(1);
  });
});
