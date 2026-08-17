import { afterEach, describe, expect, test } from 'bun:test';
import {
  createLumiInterceptors,
  type CreateLumiInterceptorsDeps,
} from './lumi-hooks.js';

describe('createLumiInterceptors registration', () => {
  afterEach(() => {
    delete (globalThis as { spindle?: unknown }).spindle;
  });

  test('registers every current hook with the existing options', () => {
    const calls: Array<{ name: string; priority: number | undefined; options?: unknown }> = [];
    (globalThis as { spindle?: unknown }).spindle = {
      contracts: { preAssemblyGenerationContext: 1 },
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
      registerContextHandler(_handler: unknown, priority?: number, options?: unknown) {
        calls.push({ name: 'context', priority, options });
      },
    };
    const deps = {
      activeCardByChat: new Map(),
      lastActiveChatByUser: new Map(),
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
  });
});
