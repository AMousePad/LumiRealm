import { afterEach, expect, test } from 'bun:test';
import type { InterceptorContextDTO, InterceptorHandler, LlmMessageDTO } from 'lumiverse-spindle-types';

import type { LlmMessage } from '../adapters/spindle-extras.js';
import type { RegexCoreScript } from '../display/regex-core.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from './lumi-hooks.js';
import type { PrebuiltPipelineInput } from './prompt-regex-apply.js';

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('dispatches prompt regex only while LumiRealm owns the prompt pass', async () => {
  let interceptor: InterceptorHandler | null = null;
  let authoritative = false;
  let activeReads = 0;
  let dispatches = 0;
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacroInterceptor() {},
    registerMessageContentProcessor() {},
    registerInterceptor(handler: InterceptorHandler) { interceptor = handler; },
    registerWorldInfoInterceptor() {},
    registerContextHandler() {},
    generate: { raw: async () => ({ content: '' }) },
    regex_scripts: {
      getActive: async () => {
        activeReads++;
        return [{
          id: 'regex',
          find_regex: 'TOKEN',
          replace_string: 'TOKEN!',
          flags: 'g',
          substitute_macros: 'none',
          placement: ['user_input'],
          target: 'prompt',
          disabled: false,
        }];
      },
    },
    chats: { get: async () => ({ metadata: {} }) },
    characters: { get: async () => ({ name: 'Character' }) },
    chat: { getMessages: async () => [] },
    personas: { getActive: async () => null },
  };
  const activeCardByChat = new Map([['chat', {
    ownerUserId: 'user',
    card: {
      character_id: 'character',
      risuPayload: { triggers: [], lua_scripts: [], extra: {} },
    },
  } as unknown as ActiveCard]]);
  createLumiInterceptors({
    activeCardByChat,
    isPromptRegexAuthoritative: () => authoritative,
    runMessageVarPass: async () => {},
    getCachedSettingsSync: () => ({ legacyMediaFindings: false }),
    modulesByNamespaceFromCard: () => null,
    dispatchPromptRegex: async (
      _prebuilt: PrebuiltPipelineInput,
      scripts: readonly RegexCoreScript[],
      messages: LlmMessage[],
    ) => {
      dispatches++;
      expect(scripts).toHaveLength(1);
      return {
        ok: true,
        changed: true,
        messages: messages.map((message) => ({ ...message, content: 'TOKEN!' })),
      };
    },
    log: { info() {}, warn() {}, error() {}, trace() {}, debug() {} },
    errMsg: String,
  } as unknown as CreateLumiInterceptorsDeps).registerAll();
  const context = {
    userId: 'user',
    chatId: 'chat',
    generationType: 'normal',
    personaId: null,
    characterId: 'character',
  } as InterceptorContextDTO;
  const input: LlmMessageDTO[] = [{ role: 'user', content: 'TOKEN' }];

  expect(await interceptor!(input, context)).toEqual(input);
  expect(activeReads).toBe(0);
  expect(dispatches).toBe(0);

  authoritative = true;
  expect(await interceptor!(input, context)).toEqual([{ role: 'user', content: 'TOKEN!' }]);
  expect(activeReads).toBe(1);
  expect(dispatches).toBe(1);
});
