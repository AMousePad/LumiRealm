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
  env: {
    chatId?: string;
    chat?: { id: string };
    userId?: string;
    args?: string[];
    messages?: unknown[];
  } = {},
): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`macro not registered: ${name}`);
  return Promise.resolve(handler({
    args: env.args ?? [],
    ...(env.chatId !== undefined ? { chatId: env.chatId } : {}),
    env: {
      ...(env.chat !== undefined ? { chat: env.chat } : {}),
      variables: { global: {}, local: {}, chat: {} },
      extra: {
        ...(env.userId !== undefined ? { userId: env.userId } : {}),
        ...(env.messages !== undefined ? { messages: env.messages } : {}),
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

// Risu's previouschatlog reads chat.message[Number(index)] (cbs.ts). The host
// serializes that same list onto env.extra.messages and indexes it with
// {{lastmessageid}}, so these tests pin the index frame, the missing-message
// result and the gate the preset chains through the read.

const SYNTH_MESSAGES = [
  { content: 'SYNTH-M0', name: 'SYNTH-CHAR', is_user: false },
  { content: 'SYNTH-M1', name: 'SYNTH-USER', is_user: true },
  { content: 'SYNTH-M2', name: 'SYNTH-CHAR', is_user: false },
];

const readAt = (handlers: Map<string, MacroHandler>, index: string) =>
  call(handlers, 'previous_chat_log', { args: [index], messages: SYNTH_MESSAGES });

test('reads the chat history at an absolute 0-based index, whatever the role', async () => {
  const { handlers } = install({});
  expect(await readAt(handlers, '0')).toBe('SYNTH-M0');
  expect(await readAt(handlers, '1')).toBe('SYNTH-M1');
  expect(await readAt(handlers, '2')).toBe('SYNTH-M2');
  // Risu's primary spelling for the same macro resolves through the same reader.
  expect(await call(handlers, 'previouschatlog', { args: ['1'], messages: SYNTH_MESSAGES })).toBe('SYNTH-M1');
  // Number() coercion matches Risu: padding and a leading sign are numeric.
  expect(await readAt(handlers, ' 1 ')).toBe('SYNTH-M1');
  expect(await readAt(handlers, '+1')).toBe('SYNTH-M1');
});

test('resolves a message that does not exist to the empty string, not the Risu sentinel', async () => {
  const { handlers } = install({});
  // Past the end, a negative index (Risu does not wrap from the end), a float
  // and a non numeric argument all select no message.
  for (const index of ['3', '-1', '1.5', 'abc']) {
    const value = await readAt(handlers, index);
    expect(value).toBe('');
    expect(value).not.toContain('Out of range');
  }
  // A bare macro has no argument at all, which is NaN in Risu's Number(args[0]).
  expect(await call(handlers, 'previous_chat_log', { messages: SYNTH_MESSAGES })).toBe('');
});

test('serves the read from the evaluation env and reads no chat', async () => {
  const { handlers } = install({});
  // No userId is needed: the host already scoped env.extra.messages, so the
  // bridge never pays an RPC and has no cache to go stale.
  expect(await readAt(handlers, '0')).toBe('SYNTH-M0');
  expect(reads).toBe(0);
});

test('degrades to the empty string with a log line when the evaluation has no history', async () => {
  const { handlers } = install({});
  logStore.setState({ enabled: true, level: 'warn' });
  expect(await call(handlers, 'previous_chat_log', { chatId: 'chat1', args: ['0'] })).toBe('');
  expect(await call(handlers, 'previous_chat_log', { userId: 'user', args: ['0'] })).toBe('');
  expect(await call(handlers, 'previous_chat_log', { args: ['0'], messages: [] })).toBe('');
  expect(warns.length).toBe(3);
  expect(warns[0]).toContain('previous_chat_log');
  expect(warns[0]).toContain('chat1');
  expect(warns[0]).toContain('no-user');
  // A missing history is not a reason to touch the host.
  expect(reads).toBe(0);
});

test('lets a caller contains gate evaluate instead of leaking the macro', async () => {
  const { handlers } = install({});
  const gate = async (index: string, needle: string) =>
    call(handlers, 'risucontains', {
      args: [await readAt(handlers, index), needle],
    });
  expect(await gate('2', 'SYNTH')).toBe('1');
  // Out of range reads empty, so a gate whose needle is the macro name is false
  // rather than true on leaked macro text.
  expect(await gate('9', 'previous_chat_log')).toBe('0');
});
