import { afterEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros.js';
import { invalidateAuthorsNoteCache } from '../../src/state/authors-note-cache.js';
import { logStore } from '../../src/log/store.js';

// The host prompt engine owns preset blocks (sourceOwner: "host"), so a preset's
// {{authornote}} slot can only resolve through a macro registered with
// spindle.registerMacro. The note itself lives in chat metadata, so these tests
// pin the reader, the empty cases and the memoization contract.

type MacroHandler = (ctx: unknown) => unknown;

interface ChatRecord {
  metadata?: Record<string, unknown>;
}

const previous = (globalThis as { spindle?: unknown }).spindle;
let reads = 0;
let calls: Array<{ chatId: string; userId: string | undefined }> = [];
let warns: string[] = [];

afterEach(() => {
  (globalThis as { spindle?: unknown }).spindle = previous;
  invalidateAuthorsNoteCache();
  logStore.setState({ enabled: false });
});

function install(chats: Record<string, ChatRecord | null>, failWith?: Error) {
  const handlers = new Map<string, MacroHandler>();
  reads = 0;
  calls = [];
  warns = [];
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (def: { name: string; handler: MacroHandler }) => {
      handlers.set(def.name.toLowerCase(), def.handler);
    },
    log: { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    chats: {
      get: async (chatId: string, userId?: string) => {
        reads++;
        calls.push({ chatId, userId });
        if (failWith) throw failWith;
        return chats[chatId] ?? null;
      },
    },
    userStorage: { getJson: async () => null, setJson: async () => {} },
  };
  registerSpindleMacros();
  return { handlers };
}

function call(
  handlers: Map<string, MacroHandler>,
  name: string,
  env: { chatId?: string; chat?: { id: string }; userId?: string } = {},
): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`macro not registered: ${name}`);
  return Promise.resolve(handler({
    args: [],
    ...(env.chatId !== undefined ? { chatId: env.chatId } : {}),
    env: {
      ...(env.chat !== undefined ? { chat: env.chat } : {}),
      variables: { global: {}, local: {}, chat: {} },
      extra: {
        ...(env.userId !== undefined ? { userId: env.userId } : {}),
      },
    },
  })) as Promise<string>;
}

const WITH_NOTE: Record<string, ChatRecord | null> = {
  chat1: { metadata: { authors_note: { content: 'SYNTH-NOTE', depth: 4, role: 'system' } } },
};

test('reads the chat author note from chat metadata', async () => {
  const { handlers } = install(WITH_NOTE);
  expect(await call(handlers, 'authornote', { chatId: 'chat1', userId: 'user' })).toBe('SYNTH-NOTE');
  expect(calls).toEqual([{ chatId: 'chat1', userId: 'user' }]);
});

test('resolves the Risu alias and the environment chat id', async () => {
  const { handlers } = install(WITH_NOTE);
  // Risu's own alias for the same macro resolves through the same reader.
  expect(await call(handlers, 'author_note', { chatId: 'chat1' })).toBe('SYNTH-NOTE');
  // env.chat.id is the primary chat source, the wire chatId the fallback.
  expect(await call(handlers, 'authornote', { chat: { id: 'chat1' } })).toBe('SYNTH-NOTE');
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('SYNTH-NOTE');
});

test('resolves a chat without a note as the empty string', async () => {
  const { handlers } = install({
    chat1: { metadata: {} },
    chat2: { metadata: { authors_note: null } },
    chat3: { metadata: { authors_note: { content: 7 } } },
    chat4: null,
  });
  for (const chatId of ['chat1', 'chat2', 'chat3', 'chat4']) {
    expect(await call(handlers, 'authornote', { chatId })).toBe('');
  }
});

test('resolves without a chat id as the empty string and reads no chat', async () => {
  const { handlers } = install(WITH_NOTE);
  expect(await call(handlers, 'authornote', { userId: 'user' })).toBe('');
  expect(reads).toBe(0);
});

test('keeps reading the note when the evaluation carries no userId', async () => {
  const { handlers } = install(WITH_NOTE);
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('SYNTH-NOTE');
  expect(calls).toEqual([{ chatId: 'chat1', userId: undefined }]);
});

test('memoizes the note per chat and drops the entry on invalidation', async () => {
  const chats: Record<string, ChatRecord | null> = {
    chat1: { metadata: { authors_note: { content: 'first' } } },
    chat2: { metadata: { authors_note: { content: 'other' } } },
  };
  const { handlers } = install(chats);
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('first');
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('first');
  expect(reads).toBe(1);

  chats.chat1 = { metadata: { authors_note: { content: 'edited' } } };
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('first');
  // A note write must not be served from the memo.
  invalidateAuthorsNoteCache('chat1');
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('edited');

  // One chat's entry does not answer for another.
  expect(await call(handlers, 'authornote', { chatId: 'chat2' })).toBe('other');
  invalidateAuthorsNoteCache();
  expect(await call(handlers, 'authornote', { chatId: 'chat2' })).toBe('other');
});

test('a failed metadata read degrades to the empty string and is not cached', async () => {
  const chats: Record<string, ChatRecord | null> = { chat1: { metadata: { authors_note: { content: 'later' } } } };
  const { handlers } = install(chats, new TypeError('chat read unavailable'));
  // The failure must be visible in the log, not swallowed.
  logStore.setState({ enabled: true, level: 'warn' });
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('');
  expect(warns.length).toBe(1);
  (globalThis as unknown as { spindle: { chats: { get: (chatId: string, userId?: string) => Promise<unknown> } } })
    .spindle.chats.get = async () => chats.chat1;
  expect(await call(handlers, 'authornote', { chatId: 'chat1' })).toBe('later');
});
