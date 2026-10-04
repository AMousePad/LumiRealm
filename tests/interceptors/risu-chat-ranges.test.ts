import { afterEach, expect, test } from 'bun:test';
import type { InterceptorContextDTO, InterceptorHandler, LlmMessageDTO } from 'lumiverse-spindle-types';
import { translateRisuPreset } from '../../src/core/preset/risup-translator.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from '../../src/interceptors/lumi-hooks.js';
import { applyRisuChatRanges } from '../../src/interceptors/risu-chat-ranges.js';

type RisuChat = { rangeStart: number; rangeEnd: number | 'end' };

// Port of Risu's sendChat 'chat' case over the host history, which has no example or separator prefix.
function risuSlice({ rangeStart, rangeEnd }: RisuChat, length: number): number[] {
  let start = rangeStart;
  let end = rangeEnd === 'end' ? length : rangeEnd;
  if (start === -1000) {
    start = 0;
    end = length;
  }
  if (start < 0) start = Math.max(0, length + start);
  if (end < 0) end = Math.max(0, length + end);
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

const presetMetadata = (chats: RisuChat[]): unknown => {
  const { metadata } = translateRisuPreset({ promptTemplate: chats.map((chat) => ({ type: 'chat', ...chat })) }).preset;
  return (metadata as { lumirealm?: unknown }).lumirealm;
};

const history = (length: number): LlmMessageDTO[] => [
  { role: 'system', content: 'main' },
  ...Array.from({ length }, (_, i): LlmMessageDTO[] => [
    { role: 'user', content: `m${i}`, __isChatHistory: true },
    { role: 'system', content: `note${i}` },
  ]).flat(),
];

for (const chats of [
  [{ rangeStart: 0, rangeEnd: -6 }, { rangeStart: -6, rangeEnd: -4 }, { rangeStart: -4, rangeEnd: 'end' }],
  [{ rangeStart: -1000, rangeEnd: 'end' }],
  [{ rangeStart: -10, rangeEnd: 'end' }],
  [{ rangeStart: 0, rangeEnd: -2 }],
  [{ rangeStart: 0, rangeEnd: -6 }, { rangeStart: -4, rangeEnd: 'end' }],
  [{ rangeStart: -8, rangeEnd: -5 }, { rangeStart: -3, rangeEnd: -1 }],
  [],
] satisfies RisuChat[][]) {
  test(`keeps the chat-history turns Risu's chat slices send: ${JSON.stringify(chats)}`, () => {
    for (let length = 0; length <= 12; length++) {
      const messages = history(length);
      const sent = new Set(chats.flatMap((chat) => risuSlice(chat, length)));
      const kept = applyRisuChatRanges(messages, presetMetadata(chats));
      expect(kept).toEqual(messages.filter((m) => !m.__isChatHistory || sent.has(Number(String(m.content).slice(1)))));
    }
  });
}

test('records no ranges for chat slices that cover the whole history', () => {
  expect(presetMetadata([{ rangeStart: 0, rangeEnd: -2 }, { rangeStart: -2, rangeEnd: 'end' }])).toBeUndefined();
  expect(translateRisuPreset({}).preset.metadata).not.toHaveProperty('lumirealm');
});

test('leaves the prompt untouched without ranges and rejects malformed ones', () => {
  const messages = history(3);
  expect(applyRisuChatRanges(messages, undefined)).toBe(messages);
  expect(applyRisuChatRanges(messages, null)).toBe(messages);
  expect(applyRisuChatRanges(messages, {})).toBe(messages);
  for (const chatRanges of [{}, [{ start: 2, end: 0 }], [{ start: null, end: 3 }], [{ start: null }]]) {
    expect(() => applyRisuChatRanges(messages, { chatRanges })).toThrow(TypeError);
  }
});

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('trims chat history in the prompt interceptor for card and non-card chats', async () => {
  let interceptor: InterceptorHandler | null = null;
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacroInterceptor() {},
    registerMessageContentProcessor() {},
    registerInterceptor(handler: InterceptorHandler) { interceptor = handler; },
    registerWorldInfoInterceptor() {},
    registerContextHandler() {},
    generate: { raw: async () => ({ content: '' }) },
    userStorage: { getJson: async () => null },
    regex_scripts: { getActive: async () => [{ id: 'regex', find_regex: 'm', replace_string: 'M', flags: 'g', substitute_macros: 'none', placement: ['user_input'], target: 'prompt', disabled: false }] },
    chats: { get: async () => ({ metadata: {} }) },
    characters: { get: async () => ({ name: 'Character' }) },
    chat: { getMessages: async () => [] },
    personas: { getActive: async () => null },
  };
  const card = {
    ownerUserId: 'user',
    card: { character_id: 'character', risuPayload: { triggers: [{ effect: [] }], lua_scripts: [], extra: {} } },
  } as unknown as ActiveCard;
  const regexInput: string[][] = [];
  const luaInput: string[][] = [];
  const contents = (messages: readonly LlmMessageDTO[]) => messages.map((m) => String(m.content));
  createLumiInterceptors({
    activeCardByChat: new Map([['card-chat', card]]),
    ensureActiveCardForChat: async () => null,
    isPromptRegexAuthoritative: (chatId: string) => chatId === 'card-chat',
    runMessageVarPass: async () => {},
    getCachedSettingsSync: () => ({ legacyMediaFindings: false }),
    modulesByNamespaceFromCard: () => null,
    dispatchPromptRegex: async (_prebuilt: unknown, _scripts: unknown, messages: LlmMessageDTO[]) => {
      regexInput.push(contents(messages));
      return { ok: true, changed: true, messages: messages.map((m) => ({ ...m, content: String(m.content).toUpperCase() })) };
    },
    executeFrontend: async (_chatId: string, _characterId: string, operation: { messages: LlmMessageDTO[] }) => {
      luaInput.push(contents(operation.messages));
      return operation.messages;
    },
    log: { info() {}, warn() {}, error() {}, trace() {}, debug() {} },
    errMsg: String,
  } as unknown as CreateLumiInterceptorsDeps).registerAll();
  const context = (chatId: string) => ({
    userId: 'user',
    chatId,
    generationType: 'normal',
    characterId: 'character',
    personaId: null,
    presetMetadata: presetMetadata([{ rangeStart: -2, rangeEnd: 'end' }]),
  }) as InterceptorContextDTO;

  expect(contents(await interceptor!(history(4), context('plain-chat')) as LlmMessageDTO[]))
    .toEqual(['main', 'note0', 'note1', 'm2', 'note2', 'm3', 'note3']);

  const sent = await interceptor!(history(4), context('card-chat')) as LlmMessageDTO[];
  // Risu runs prompt regex over the whole chat list and editRequest triggers on the sliced request.
  expect(regexInput).toEqual([contents(history(4))]);
  expect(luaInput).toEqual([['MAIN', 'NOTE0', 'NOTE1', 'M2', 'NOTE2', 'M3', 'NOTE3']]);
  expect(contents(sent)).toEqual(luaInput[0]!);
});
