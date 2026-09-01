import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  createLumiInterceptors,
  type CreateLumiInterceptorsDeps,
} from '../../src/interceptors/lumi-hooks.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { StoredRisuCard } from '../../src/payload/types.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { resetMacroInterceptorCache } from '../../src/state/macro-interceptor-cache.js';
import { resetRenderMcpCache } from '../../src/state/render-mcp-cache.js';
import { resetListenEditPreloadCache } from '../../src/interpreter/listenedit-preload.js';

interface CapturedHandlers {
  macroInterceptor: ((ctx: unknown) => Promise<unknown>) | null;
  macroPriority: number | undefined;
  messageContentProcessor: ((ctx: unknown) => Promise<{ content?: string } | void>) | null;
  mcpPriority: number | undefined;
  interceptor: ((messages: unknown[], context: unknown) => Promise<unknown>) | null;
  interceptorPriority: number | undefined;
  worldInfoInterceptor: ((ctx: unknown) => Promise<unknown>) | null;
  worldInfoPriority: number | undefined;
  contextHandler: ((ctx: unknown) => Promise<unknown>) | null;
  contextPriority: number | undefined;
  contextOptions: Readonly<Record<string, unknown>> | undefined;
}

interface SpindleStub {
  chatsGetCalls: Array<{ chatId: string; userId: string }>;
  chatsUpdateCalls: Array<{ chatId: string; metadata: unknown; userId: string }>;
  chatsGetReturn: ((chatId: string, userId: string) => unknown) | null;
  chatsUpdateReturn: unknown;
}

function setupSpindle(stub: SpindleStub, captured: CapturedHandlers): void {
  (globalThis as unknown as { spindle: unknown }).spindle = {
    registerMacroInterceptor(handler: typeof captured.macroInterceptor, priority?: number) {
      captured.macroInterceptor = handler;
      captured.macroPriority = priority;
    },
    registerMessageContentProcessor(handler: typeof captured.messageContentProcessor, priority?: number) {
      captured.messageContentProcessor = handler;
      captured.mcpPriority = priority;
    },
    registerInterceptor(handler: typeof captured.interceptor, priority?: number) {
      captured.interceptor = handler;
      captured.interceptorPriority = priority;
    },
    registerWorldInfoInterceptor(handler: typeof captured.worldInfoInterceptor, priority?: number) {
      captured.worldInfoInterceptor = handler;
      captured.worldInfoPriority = priority;
    },
    registerContextHandler(
      handler: typeof captured.contextHandler,
      priority?: number,
      options?: Readonly<Record<string, unknown>>,
    ) {
      captured.contextHandler = handler;
      captured.contextPriority = priority;
      captured.contextOptions = options;
    },
    generate: { raw: async () => ({ content: '' }) },
    chats: {
      get: async (chatId: string, userId: string) => {
        stub.chatsGetCalls.push({ chatId, userId });
        return stub.chatsGetReturn ? stub.chatsGetReturn(chatId, userId) : null;
      },
      update: async (chatId: string, input: { metadata?: unknown }, userId: string) => {
        stub.chatsUpdateCalls.push({ chatId, metadata: input.metadata, userId });
        return stub.chatsUpdateReturn;
      },
    },
  };
}

function teardownSpindle(): void {
  delete (globalThis as unknown as { spindle?: unknown }).spindle;
}

interface MockState {
  warns: string[];
  infos: string[];
  errors: string[];
  ensureCalls: Array<{ chatId: string; characterId: string | null; userId: string | undefined }>;
  captureCalls: Array<{ userId: string | undefined; where: string }>;
  resolveCalls: Array<{ template: string; chatId: string; opts?: { cbsContext?: boolean } }>;
  resolveManyCalls: Array<{ templates: readonly string[]; chatId: string }>;
  messageVarCalls: Array<{ chatId: string; characterId: string; userId: string }>;
}

function makeCapturedHandlers(): CapturedHandlers {
  return {
    macroInterceptor: null,
    macroPriority: undefined,
    messageContentProcessor: null,
    mcpPriority: undefined,
    interceptor: null,
    interceptorPriority: undefined,
    worldInfoInterceptor: null,
    worldInfoPriority: undefined,
    contextHandler: null,
    contextPriority: undefined,
    contextOptions: undefined,
  };
}

function makeSpindleStub(overrides?: Partial<SpindleStub>): SpindleStub {
  return {
    chatsGetCalls: [],
    chatsUpdateCalls: [],
    chatsGetReturn: null,
    chatsUpdateReturn: null,
    ...(overrides ?? {}),
  };
}

function makeStubActiveCard(characterId = 'char-1'): ActiveCard {
  const card = {
    character_id: characterId,
    asset_index: {},
    emotion_index: {},
    regex_scripts: [],
    risuPayload: {
      requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
      triggers: [],
      lua_scripts: [],
      scriptstate_defaults: {},
      background_html: null,
      module_background_embedding: '',
      utility_bot: false,
      at_actions: [],
      translator_version: '0.0.0',
      extra: {},
    },
  } as unknown as StoredRisuCard;
  return {
    card,
    chatId: 'chat-1',
    ownerUserId: 'user-1',
    characterWorldBookIds: ['book-1'],
    lumirealm: { user_overrides: {}, default_variables_overrides: {} } as unknown as ActiveCard['lumirealm'],
  } as unknown as ActiveCard;
}

function worldInfoEntry(
  id: string,
  patch: Partial<{
    disabled: boolean;
    comment: string;
    key: readonly string[];
    keysecondary: readonly string[];
    content: string;
    priority: number;
    extensions: Readonly<Record<string, unknown>>;
    book_source: string;
  }> = {},
) {
  return {
    id,
    disabled: false,
    comment: id,
    key: [],
    keysecondary: [],
    content: `${id} content`,
    priority: 0,
    extensions: {},
    book_source: 'character',
    ...patch,
  };
}

function worldInfoMessage(
  id: string,
  content: string,
  patch: Partial<{
    role: 'system' | 'user' | 'assistant';
    is_user: boolean;
    is_greeting: boolean;
    greeting_index: number;
  }> = {},
) {
  return {
    id,
    role: 'user' as const,
    content,
    is_user: true,
    is_greeting: false,
    ...patch,
  };
}

function macroEnv() {
  return {
    chat: { id: 'chat-1' },
    character: { name: 'X' },
    names: { user: 'Alice', char: 'X' },
    variables: { local: {}, global: {}, chat: {} },
    system: {},
  };
}

function makeMockDeps(overrides?: Partial<CreateLumiInterceptorsDeps>): {
  deps: CreateLumiInterceptorsDeps;
  state: MockState;
} {
  const state: MockState = {
    warns: [],
    infos: [],
    errors: [],
    ensureCalls: [],
    captureCalls: [],
    resolveCalls: [],
    resolveManyCalls: [],
    messageVarCalls: [],
  };
  const deps: CreateLumiInterceptorsDeps = {
    activeCardByChat: new Map(),
    captureUserId: (userId, where) => {
      state.captureCalls.push({ userId, where });
    },
    ensureActiveCardForChat: async (chatId, characterId, userId) => {
      state.ensureCalls.push({ chatId, characterId, userId });
      return null;
    },
    getCachedSettingsSync: () => DEFAULT_SETTINGS,
    modulesByNamespaceFromCard: () => null,
    resolveReadonly: async (template, chatId, _characterId, _userId, opts) => {
      state.resolveCalls.push({ template, chatId, ...(opts ? { opts } : {}) });
      return template;
    },
    resolveReadonlyMany: async (templates, chatId) => {
      state.resolveManyCalls.push({ templates, chatId });
      return templates;
    },
    runMessageVarPass: async (chatId, characterId, userId) => {
      state.messageVarCalls.push({ chatId, characterId, userId });
    },
    runBinding: async () => ({ stopSending: false }),
    log: {
      info: (m) => { state.infos.push(m); },
      warn: (m) => { state.warns.push(m); },
      error: (m) => { state.errors.push(m); },
      trace: () => undefined,
      debug: () => undefined,
    },
    errMsg: (e) => e instanceof Error ? e.message : String(e),
    isFeDisplayAuthoritative: () => false,
    isPromptRegexAuthoritative: () => false,
    dispatchPromptRegex: async (_prebuilt, _scripts, messages) => ({ ok: false, changed: false, messages }),
    ...(overrides ?? {}),
  };
  return { deps, state };
}

describe('createLumiInterceptors', () => {
  let captured: CapturedHandlers;
  let stub: SpindleStub;

  beforeEach(() => {
    captured = makeCapturedHandlers();
    stub = makeSpindleStub();
  });

  afterEach(() => {
    resetMacroInterceptorCache();
    resetRenderMcpCache();
    resetListenEditPreloadCache();
    teardownSpindle();
  });

  test('registerAll wires all five handlers at priority=100', () => {
    setupSpindle(stub, captured);
    const { deps } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    expect(captured.macroInterceptor).not.toBeNull();
    expect(captured.macroPriority).toBe(100);
    expect(captured.messageContentProcessor).not.toBeNull();
    expect(captured.mcpPriority).toBe(100);
    expect(captured.interceptor).not.toBeNull();
    expect(captured.interceptorPriority).toBe(100);
    expect(captured.worldInfoInterceptor).not.toBeNull();
    expect(captured.worldInfoPriority).toBe(100);
    expect(captured.contextHandler).not.toBeNull();
    expect(captured.contextPriority).toBe(100);
    expect(captured.contextOptions).toEqual({ timeoutMs: 30_000 });
  });

  test('macroInterceptor: passthrough when template lacks {{', async () => {
    setupSpindle(stub, captured);
    const { deps, state } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const result = await captured.macroInterceptor!({
      template: 'plain text no macros',
      env: { chat: { id: 'chat-1' } },
      commit: false,
      phase: 'display',
      userId: 'user-1',
    });
    expect(result).toBeUndefined();
    expect(state.captureCalls.length).toBe(0);
  });

  test('macroInterceptor: accepts plain character prompt sources', async () => {
    setupSpindle(stub, captured);
    const { deps, state } = makeMockDeps();
    deps.activeCardByChat.set('chat-1', makeStubActiveCard());
    createLumiInterceptors(deps).registerAll();

    const result = await captured.macroInterceptor!({
      template: 'plain character text',
      sourceHint: 'prompt_source:character.description',
      env: macroEnv(),
      commit: true,
      phase: 'prompt',
      userId: 'user-1',
    }) as unknown as { text: string };

    expect(result.text).toBe('plain character text');
    expect(state.captureCalls).toEqual([{ userId: 'user-1', where: 'macroInterceptor' }]);
  });

  test('macroInterceptor: warns and skips when chat has no active card', async () => {
    setupSpindle(stub, captured);
    const { deps, state } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const result = await captured.macroInterceptor!({
      template: 'before {{user}} after',
      env: { chat: { id: 'chat-orphan' } },
      commit: false,
      phase: 'display',
      userId: 'user-1',
    });
    expect(result).toBeUndefined();
    expect(state.captureCalls).toEqual([{ userId: 'user-1', where: 'macroInterceptor' }]);
    expect(state.warns.some((w) => w.includes('path=no_active_card'))).toBe(true);
  });

  test('macroInterceptor: warns owner_mismatch when ctx.userId differs from active.ownerUserId', async () => {
    setupSpindle(stub, captured);
    const { deps, state } = makeMockDeps();
    deps.activeCardByChat.set('chat-1', makeStubActiveCard());
    createLumiInterceptors(deps).registerAll();
    const result = await captured.macroInterceptor!({
      template: '{{user}}',
      env: macroEnv(),
      commit: false,
      phase: 'display',
      userId: 'user-2',
    });
    expect(result).toBeUndefined();
    expect(state.warns.some((w) => w.includes('path=owner_mismatch'))).toBe(true);
  });

  test('macroInterceptor: Risu structural blocks stay on the Risu evaluator path', async () => {
    setupSpindle(stub, captured);
    const { deps } = makeMockDeps();
    deps.activeCardByChat.set('chat-1', makeStubActiveCard());
    createLumiInterceptors(deps).registerAll();
    const result = await captured.macroInterceptor!({
      template: '{{#if 1}}raw Risu{{/if}}',
      env: macroEnv(),
      commit: true,
      phase: 'prompt',
      userId: 'user-1',
    }) as unknown as { text: string };
    expect(result.text).toContain('Risu');
    expect(result.text).not.toContain('{{');
  });

  test('contextHandler: runs input then start bindings and returns the context unchanged', async () => {
    setupSpindle(stub, captured);
    const order: string[] = [];
    const { deps } = makeMockDeps({
      runBinding: async (_active, _chatId, binding) => {
        order.push(binding);
        return { stopSending: false };
      },
    });
    deps.activeCardByChat.set('chat-1', makeStubActiveCard());
    createLumiInterceptors(deps).registerAll();

    const input = {
      chatId: 'chat-1',
      userId: 'user-1',
      generationType: 'normal',
      dryRun: false,
    };
    const result = await captured.contextHandler!(input);

    expect(result).toBe(input);
    expect(order).toEqual(['input', 'start']);
  });

  test('messageContentProcessor: returns undefined when ensureActiveCardForChat returns null', async () => {
    setupSpindle(stub, captured);
    const { deps, state } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const result = await captured.messageContentProcessor!({
      chatId: 'chat-not-lumirealm',
      messageId: 'msg-1',
      content: 'hello',
      isUser: false,
      origin: 'create',
      userId: 'user-1',
    });
    expect(result).toBeUndefined();
    expect(state.ensureCalls).toEqual([
      { chatId: 'chat-not-lumirealm', characterId: null, userId: 'user-1' },
    ]);
  });

  test('messageContentProcessor: does not run editoutput actions on user writes', async () => {
    setupSpindle(stub, captured);
    (globalThis as unknown as {
      spindle: { chat: { getMessages: () => Promise<unknown[]> } };
    }).spindle.chat = {
      getMessages: async () => [
        { id: 'prior', role: 'assistant', content: 'TOKEN' },
      ],
    };
    const active = makeStubActiveCard();
    (active.card.risuPayload as { at_actions: unknown }).at_actions = [{
      action: 'repeat_back',
      script: { in: 'TOKEN', out: '@@repeat_back end' },
      flag: 'g',
      phase: 'editoutput',
      order: 0,
    }] as never;
    const { deps } = makeMockDeps({
      ensureActiveCardForChat: async () => active,
    });
    deps.activeCardByChat.set('chat-1', active);
    createLumiInterceptors(deps).registerAll();

    const userResult = await captured.messageContentProcessor!({
      chatId: 'chat-1',
      content: 'fresh',
      isUser: true,
      origin: 'create',
      userId: 'user-1',
    });
    const assistantResult = await captured.messageContentProcessor!({
      chatId: 'chat-1',
      content: 'fresh',
      isUser: false,
      origin: 'create',
      userId: 'user-1',
    });

    expect(userResult).toBeUndefined();
    expect(assistantResult).toEqual({ content: 'freshTOKEN' });
  });

  test('interceptor: passthrough when chatId missing', async () => {
    setupSpindle(stub, captured);
    const { deps } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const result = await captured.interceptor!(messages, { chatId: null });
    expect(result).toBe(messages);
  });

  test('interceptor: passthrough when the chat has no active card', async () => {
    setupSpindle(stub, captured);
    const { deps } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const result = await captured.interceptor!(messages, { chatId: 'chat-cold', generationType: 'normal' });
    expect(result).toBe(messages);
  });

  test('worldInfoInterceptor: empty entries produces no spindle.chats.update', async () => {
    setupSpindle(stub, captured);
    stub.chatsGetReturn = () => ({ metadata: { macro_variables: { local: {} } } });
    const { deps } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    await captured.worldInfoInterceptor!({
      chatId: 'chat-1',
      userId: 'user-1',
      entries: [],
      messages: [],
      chatTurn: 0,
      chatMetadata: {},
    });
    expect(stub.chatsUpdateCalls.length).toBe(0);
  });

  test('worldInfoInterceptor: handles missing userId cleanly', async () => {
    setupSpindle(stub, captured);
    const { deps } = makeMockDeps();
    createLumiInterceptors(deps).registerAll();
    const result = await captured.worldInfoInterceptor!({
      assemblyId: 'assembly-1',
      chatId: 'chat-1',
      entries: [],
      messages: [],
      chatTurn: 0,
      chatMetadata: {},
    });
    expect(result).toBeUndefined();
  });

  test('worldInfoInterceptor: persists sticky keep-activate writes via one chats.update', async () => {
    setupSpindle(stub, captured);
    stub.chatsGetReturn = () => ({ metadata: {} });
    const { deps } = makeMockDeps();
    deps.activeCardByChat.set('chat-1', makeStubActiveCard());
    createLumiInterceptors(deps).registerAll();

    const result = await captured.worldInfoInterceptor!({
      chatId: 'chat-1',
      characterId: 'char-1',
      userId: 'user-1',
      entries: [
        worldInfoEntry('dragon-lore', {
          key: ['dragon'],
          content: 'sticky body',
          extensions: {
            _risu_array_index: 0,
            _risu_decorators: [{ name: 'keep_activate_after_match', args: [] }],
          },
        }),
      ],
      messages: [worldInfoMessage('message-1', 'a dragon flew overhead')],
      chatTurn: 1,
      chatMetadata: {},
      activationSettings: { globalScanDepth: 5 },
      generationType: 'normal',
      dryRun: false,
    });

    expect(result).toBeUndefined();
    expect(stub.chatsUpdateCalls).toEqual([{
      chatId: 'chat-1',
      metadata: { chat_variables: { '__internal_ka_dragon-lore': '1' } },
      userId: 'user-1',
    }]);
  });
});
