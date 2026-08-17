import { afterEach, describe, expect, test } from 'bun:test';
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
    let contextHandler: ((context: unknown) => Promise<unknown>) | null = null;
    (globalThis as { spindle?: unknown }).spindle = {
      registerMacroInterceptor(_handler: unknown, priority?: number) {
        calls.push({ name: 'macro', priority });
      },
      registerMessageContentProcessor(_handler: unknown, priority?: number) {
        calls.push({ name: 'message', priority });
      },
      registerInterceptor(_handler: unknown, priority?: number) {
        calls.push({ name: 'prompt', priority });
      },
      registerWorldInfoInterceptor(_handler: unknown, priority?: number) {
        calls.push({ name: 'worldInfo', priority });
      },
      registerContextHandler(handler: (context: unknown) => Promise<unknown>, priority?: number, options?: unknown) {
        contextHandler = handler;
        calls.push({ name: 'context', priority, options });
      },
    };
    const activeCardByChat = new Map();
    const deps = {
      activeCardByChat,
      lastActiveChatByUser: new Map(),
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
  });
});
