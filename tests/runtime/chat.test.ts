import { describe, expect, test, beforeEach } from 'bun:test';
import { makeChatApi, type ChatApi } from '../../src/interpreter/runtime/chat.js';
import type { HostApi, HostMessage } from '../../src/interpreter/host.js';

interface FakeApiState {
  api: HostApi;
  messages: HostMessage[];
  injects: Array<{ id: string; content: string; opts: unknown }>;
  deletes: string[];
  edits: Array<{ id: string; content: string }>;
  sends: Array<{ content: string; role: string }>;
}

function makeFakeApi(initial: HostMessage[] = []): FakeApiState {
  const messages = [...initial];
  const injects: FakeApiState['injects'] = [];
  const deletes: string[] = [];
  const edits: FakeApiState['edits'] = [];
  const sends: FakeApiState['sends'] = [];
  let _idGen = messages.length;
  const api = {
    chat: {
      async getMessages() { return messages; },
      async sendMessage(content: string, opts?: { role?: string }) {
        const id = `mock-${++_idGen}`;
        sends.push({ content, role: opts?.role ?? 'user' });
        return { id };
      },
      async editMessage(id: string, content: string) {
        edits.push({ id, content });
      },
      async deleteMessage(id: string) {
        deletes.push(id);
      },
      async inject(id: string, content: string, opts: unknown) {
        injects.push({ id, content, opts });
      },
      async getMetadata() { return {}; },
      async setMetadata() {},
    },
    characters: {
      get: async () => { throw new Error('not wired'); },
      update: async () => { throw new Error('not wired'); },
    },
  } as unknown as HostApi;
  return { api, messages, injects, deletes, edits, sends };
}

const SAMPLE: HostMessage[] = [
  { id: 'm1', role: 'user',      content: 'hi' },
  { id: 'm2', role: 'assistant', content: 'hello there' },
  { id: 'm3', role: 'user',      content: 'how are you' },
  { id: 'm4', role: 'assistant', content: 'doing fine' },
];

function newChat(initial: HostMessage[] = SAMPLE): {
  chat: ChatApi;
  state: { messagesCache: HostMessage[]; loopCounter: { value: number }; additionalSysPrompt: Record<'start'|'historyend'|'promptend', string> };
  fake: FakeApiState;
  notified: string[];
} {
  const fake = makeFakeApi(initial);
  // The chat closure mutates messagesCache directly — give it a copy so we
  // can still inspect the original. Tests against state.messagesCache observe
  // post-mutation; tests against fake.messages observe what api was given.
  const messagesCache = [...initial];
  const state = {
    messagesCache,
    loopCounter: { value: 0 },
    additionalSysPrompt: { start: '', historyend: '', promptend: '' },
  };
  const notified: string[] = [];
  const chat = makeChatApi(fake.api, state, (src) => notified.push(src));
  return { chat, state, fake, notified };
}

describe('chat.read accessors', () => {
  let h: ReturnType<typeof newChat>;
  beforeEach(() => { h = newChat(); });

  test('getMessageCount', () => {
    expect(h.chat.getMessageCount()).toBe(4);
  });

  test('getLastMessage', () => {
    expect(h.chat.getLastMessage()).toBe('doing fine');
  });

  test('getFirstMessage', () => {
    expect(h.chat.getFirstMessage()).toBe('hi');
  });

  test('getLastUserMessage skips assistant', () => {
    expect(h.chat.getLastUserMessage()).toBe('how are you');
  });

  test('getLastCharMessage skips user', () => {
    expect(h.chat.getLastCharMessage()).toBe('doing fine');
  });

  test('getMessageAtIndex positive', () => {
    expect(h.chat.getMessageAtIndex(1)).toBe('hello there');
  });

  test('getMessageAtIndex negative (from end)', () => {
    expect(h.chat.getMessageAtIndex(-1)).toBe('doing fine');
    expect(h.chat.getMessageAtIndex(-2)).toBe('how are you');
  });

  test('getMessageAtIndex out of range → empty', () => {
    expect(h.chat.getMessageAtIndex(99)).toBe('');
  });

  test('getMessagesTail returns last N', () => {
    const tail = h.chat.getMessagesTail(2);
    expect(tail.length).toBe(2);
    expect(tail[0]?.content).toBe('how are you');
    expect(tail[1]?.content).toBe('doing fine');
  });

  test('getMessagesTail clamps to length', () => {
    expect(h.chat.getMessagesTail(99).length).toBe(4);
  });

  test('empty cache → all reads return empty', () => {
    const empty = newChat([]);
    expect(empty.chat.getMessageCount()).toBe(0);
    expect(empty.chat.getLastMessage()).toBe('');
    expect(empty.chat.getFirstMessage()).toBe('');
    expect(empty.chat.getLastUserMessage()).toBe('');
    expect(empty.chat.getLastCharMessage()).toBe('');
  });
});

describe('chat.quickSearchChat', () => {
  let h: ReturnType<typeof newChat>;
  beforeEach(() => { h = newChat(); });

  test('default (word) condition matches whole-word', () => {
    expect(h.chat.quickSearchChat('fine', 'word', 5)).toBe(true);
    expect(h.chat.quickSearchChat('partial-no-match', 'word', 5)).toBe(false);
  });

  test('loose condition substring-matches', () => {
    expect(h.chat.quickSearchChat('hell', 'loose', 5)).toBe(true);
    expect(h.chat.quickSearchChat('xyz', 'loose', 5)).toBe(false);
  });

  test('regex condition', () => {
    expect(h.chat.quickSearchChat('hell.', 'regex', 5)).toBe(true);
    expect(h.chat.quickSearchChat('\\d{5}', 'regex', 5)).toBe(false);
  });

  test('depth limits search window', () => {
    // Greeting "hi" only in first message; depth=1 should not see it
    expect(h.chat.quickSearchChat('hi', 'word', 1)).toBe(false);
    expect(h.chat.quickSearchChat('hi', 'word', 99)).toBe(true);
  });
});

describe('chat.impersonate', () => {
  test('user impersonate adds to cache + calls sendMessage', async () => {
    const h = newChat([]);
    await h.chat.impersonate('user', 'test message');
    expect(h.fake.sends.length).toBe(1);
    expect(h.fake.sends[0]?.role).toBe('user');
    expect(h.fake.sends[0]?.content).toBe('test message');
    expect(h.state.messagesCache.length).toBe(1);
    expect(h.state.messagesCache[0]?.content).toBe('test message');
  });

  test('char role coerces to assistant', async () => {
    const h = newChat([]);
    await h.chat.impersonate('char', 'as the bot');
    expect(h.fake.sends[0]?.role).toBe('assistant');
    expect(h.state.messagesCache[0]?.role).toBe('assistant');
  });

  test('bot role (Risu char alias) also coerces to assistant', async () => {
    const h = newChat([]);
    await h.chat.impersonate('bot', 'as the bot');
    expect(h.fake.sends[0]?.role).toBe('assistant');
    expect(h.state.messagesCache[0]?.role).toBe('assistant');
  });

  // Mirrors Risu's setChatRole: `value === 'user' ? 'user' : 'char'` —
  // anything not 'user' becomes char (assistant in Lumi shape).
  test('non-user role coerces to assistant (Risu setChatRole parity)', async () => {
    const h = newChat([]);
    await h.chat.impersonate('something-weird', 'x');
    expect(h.fake.sends[0]?.role).toBe('assistant');
  });
});

describe('chat.systemPrompt', () => {
  test('accumulates into additionalSysPrompt + calls inject', async () => {
    const h = newChat();
    await h.chat.systemPrompt('start', 'first');
    await h.chat.systemPrompt('start', 'second');
    expect(h.state.additionalSysPrompt.start).toBe('first\n\nsecond\n\n');
    expect(h.fake.injects.length).toBe(2);
    // Different inject IDs (loopCounter increments)
    expect(h.fake.injects[0]?.id).not.toBe(h.fake.injects[1]?.id);
  });

  test('unknown location → defaults to promptend', async () => {
    const h = newChat();
    await h.chat.systemPrompt('mystery', 'val');
    expect(h.state.additionalSysPrompt.promptend).toBe('val\n\n');
  });

  test('inject id includes location + counter', async () => {
    const h = newChat();
    await h.chat.systemPrompt('historyend', 'x');
    expect(h.fake.injects[0]?.id).toMatch(/^risu-sys-historyend-1$/);
  });
});

describe('chat.cutChat', () => {
  test('deletes range + splices cache', async () => {
    const h = newChat();
    await h.chat.cutChat(1, 3);
    // Should delete m2 + m3 (indices 1, 2 — range is hi exclusive)
    expect(h.fake.deletes.sort()).toEqual(['m2', 'm3']);
    expect(h.state.messagesCache.length).toBe(2);
    expect(h.state.messagesCache[0]?.id).toBe('m1');
    expect(h.state.messagesCache[1]?.id).toBe('m4');
  });

  test('end-clamps to length', async () => {
    const h = newChat();
    await h.chat.cutChat(2, 99);
    expect(h.state.messagesCache.length).toBe(2);
  });

  test('start-clamps to 0', async () => {
    const h = newChat();
    await h.chat.cutChat(-5, 2);
    expect(h.state.messagesCache.length).toBe(2);
    expect(h.state.messagesCache[0]?.id).toBe('m3');
  });
});

describe('chat.modifyChat', () => {
  test('positive index edits message', async () => {
    const h = newChat();
    await h.chat.modifyChat(1, 'replaced');
    expect(h.fake.edits[0]?.id).toBe('m2');
    expect(h.fake.edits[0]?.content).toBe('replaced');
    expect(h.state.messagesCache[1]?.content).toBe('replaced');
  });

  test('negative index → from end', async () => {
    const h = newChat();
    await h.chat.modifyChat(-1, 'last-edit');
    expect(h.fake.edits[0]?.id).toBe('m4');
    expect(h.state.messagesCache[3]?.content).toBe('last-edit');
  });

  test('out of range → no-op', async () => {
    const h = newChat();
    await h.chat.modifyChat(99, 'never-applied');
    expect(h.fake.edits.length).toBe(0);
  });
});

describe('chat.updateGUI / updateChatAt', () => {
  test('updateGUI fires notifyStateChanged with source', async () => {
    const h = newChat();
    await h.chat.updateGUI();
    expect(h.notified).toEqual(['updateGUI']);
  });

  test('updateChatAt fires notifyStateChanged with source', async () => {
    const h = newChat();
    await h.chat.updateChatAt(2);
    expect(h.notified).toEqual(['updateChatAt']);
  });
});

describe('chat.tokenize / command — unsupported', () => {
  test('tokenize throws RisuCompatUnsupportedError', () => {
    const h = newChat();
    expect(() => h.chat.tokenize('text')).toThrow();
  });

  test('command throws RisuCompatUnsupportedError', async () => {
    const h = newChat();
    await expect(h.chat.command('foo')).rejects.toThrow();
  });
});
