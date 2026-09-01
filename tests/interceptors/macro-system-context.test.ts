import { afterEach, describe, expect, test } from 'bun:test';
import { createLumiInterceptors } from '../../src/interceptors/lumi-hooks.js';

describe('macro interceptor system context', () => {
  afterEach(() => {
    delete (globalThis as { spindle?: unknown }).spindle;
  });

  test('forwards the host model and max-context setting', async () => {
    let macroInterceptor: ((ctx: any) => Promise<any>) | undefined;
    (globalThis as { spindle?: unknown }).spindle = {
      registerMacroInterceptor(handler: typeof macroInterceptor) {
        macroInterceptor = handler;
      },
      registerMessageContentProcessor() {},
      registerInterceptor() {},
      registerWorldInfoInterceptor() {},
      registerContextHandler() {},
      worldInfo: {
        setInterceptorChatScope() {},
      },
    };

    const activeCard = {
      ownerUserId: 'user-1',
      card: {
        character_id: 'char-1',
        asset_index: {},
        emotion_index: {},
        risuPayload: {
          scriptstate_defaults: {},
          triggers: [],
          lua_scripts: [],
          at_actions: [],
          extra: {},
        },
      },
    };
    const activeCardByChat = new Map([['chat-1', activeCard]]);
    createLumiInterceptors({
      activeCardByChat,
      lastActiveChatByUser: new Map(),
      captureUserId() {},
      async ensureActiveCardForChat() {
        return activeCard;
      },
      getCachedSettingsSync: () => ({ legacyMediaFindings: false }),
      modulesByNamespaceFromCard: () => null,
      resolveReadonly: async (template: string) => template,
      createReadonlyManySession: () => ({
        resolve: async (templates: readonly string[]) => templates,
      }),
      runMessageVarPass: async () => {},
      runBinding: async () => ({ stopSending: false }),
      log: {
        info() {},
        warn() {},
        error() {},
        trace() {},
        debug() {},
      },
      errMsg: (error: unknown) => String(error),
      isFeDisplayAuthoritative: () => false,
      isPromptRegexAuthoritative: () => false,
      dispatchPromptRegex: async (_prebuilt: unknown, _scripts: unknown, messages: unknown) => ({
        ok: false,
        changed: false,
        messages,
      }),
    } as any).registerAll();

    const template =
      '{{model}}|{{maxcontext}}|{{firstmsgindex}}|{{previouscharchat}}';
    const ctx = {
      template,
      ownedSourceRanges: [{ start: 0, end: template.length }],
      env: {
        chat: { id: 'chat-1', greetingIndex: 2 },
        character: {
          name: 'Character',
          firstMessage: 'Edited alternate two',
          alternateGreetings: ['Alternate one', 'Alternate two'],
        },
        names: { user: 'User', char: 'Character' },
        variables: { local: {}, global: {}, chat: {} },
        system: {
          model: 'claude-sonnet-4-5',
          maxContext: 32768,
        },
      },
      commit: true,
      phase: 'prompt',
      userId: 'user-1',
    };
    const result = await macroInterceptor!(ctx);

    expect(result.text).toBe(
      'claude-sonnet-4-5|32768|1|Edited alternate two',
    );
    expect(result.claimed).toBeUndefined();

    const ownedResult = await macroInterceptor!({
      ...ctx,
      sourceHint: 'prompt_source:character.system_prompt',
      env: { ...ctx.env, extra: { characterId: 'char-1' } },
    });
    expect(ownedResult).toMatchObject({
      text: 'claude-sonnet-4-5|32768|1|Edited alternate two',
    });
    expect(ownedResult.claimed).toBeUndefined();

    expect((await macroInterceptor!({
      ...ctx,
      sourceHint: 'prompt_source:character.system_prompt',
      env: { ...ctx.env, extra: { characterId: 'char-2' } },
    })).text).toBe('claude-sonnet-4-5|32768|1|Edited alternate two');
  });
});
