import { describe, test, expect, beforeEach } from 'bun:test';
import { createReadonlyResolver } from '../../src/state/readonly-resolver.js';
import { createMessageVarPass } from '../../src/state/message-var-pass.js';
import { invalidateRecentFlush } from '../../src/state/recent-flush-cache.js';
import { clearVarOverlay } from '../../src/interpreter/evaluator/context.js';
import { setDecoratorBuffers, clearDecoratorBuffers } from '../../src/interpreter/decorator-buffers.js';
import '../../src/risu-compat/handlers/index.js';

// End-to-end parity harness for message-text setvar against Risu's
// runCurrentChatFunction: strip-once, persist to chat_variables, greeting
// excluded, cross-turn accumulation, restart survival, trigger-write merge.

interface MockMsg {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  send_date?: number;
  name?: string;
}

interface MockDb {
  messages: MockMsg[];
  metadata: Record<string, unknown>;
}

const CHAT = 'chat-1';
const CHAR = 'char-1';
const USER = 'user-1';

function installMockSpindle(db: MockDb): void {
  (globalThis as Record<string, unknown>).spindle = {
    chats: {
      get: async () => ({ id: CHAT, metadata: db.metadata }),
      update: async (_id: string, input: { metadata?: Record<string, unknown> }) => {
        if (input.metadata) db.metadata = input.metadata;
      },
    },
    characters: {
      get: async () => ({ id: CHAR, name: 'Alice' }),
    },
    personas: {
      getActive: async () => ({ name: 'Bob' }),
    },
    chat: {
      getMessages: async () => db.messages.map((m) => ({ ...m })),
      updateMessage: async (_chatId: string, id: string, input: { content: string }) => {
        const m = db.messages.find((x) => x.id === id);
        if (m) m.content = input.content;
      },
    },
    connections: { list: async () => [] },
    // makeSpindleHost dereferences generate.raw eagerly (newest-host-only contract).
    generate: { raw: async () => ({ content: '' }) },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeHarness(db: MockDb) {
  installMockSpindle(db);
  const resolver = createReadonlyResolver({
    activeCardByChat: new Map(),
    getCachedSettingsSync: () => ({ legacyMediaFindings: false }) as never,
    modulesByNamespaceFromCard: () => null,
    log: noopLog,
    errMsg: (e) => String(e),
  });
  const pass = createMessageVarPass({
    stripMessageSetvars: resolver.stripMessageSetvars,
    refreshMessagesCache: async () => {},
    invalidateRenderMcpForChat: () => {},
    invalidateMacroInterceptorForChat: () => {},
    log: noopLog,
    errMsg: (e) => String(e),
  });
  return { resolver, pass };
}

function chatVars(db: MockDb): Record<string, string> {
  return (db.metadata['chat_variables'] ?? {}) as Record<string, string>;
}

beforeEach(() => {
  invalidateRecentFlush(CHAT);
  clearVarOverlay(CHAT);
  clearDecoratorBuffers(CHAT);
});

describe('readonly world-info CBS resolve', () => {
  test('resolveMany with cbsContext resolves entry content from host state', async () => {
    const db: MockDb = {
      messages: [{ id: 'm1', role: 'user', content: 'question' }],
      metadata: { chat_variables: { hp: '42' } },
    };
    const { resolver } = makeHarness(db);
    const host = (globalThis as unknown as {
      spindle: { characters: { get: () => Promise<unknown> } };
    }).spindle;
    host.characters.get = async () => ({
      id: CHAR,
      name: 'Alice',
      description: 'Snapshot description',
    });

    expect(
      await resolver.resolveMany(
        ['{{user}}/{{char}}/{{description}}/{{getvar::hp}}/{{messagecount}}'],
        CHAT,
        CHAR,
        USER,
        { cbsContext: true },
      ),
    ).toEqual(['Bob/Alice/Snapshot description/42/1']);
  });

  test('uses Risu greeting-excluded message indexes and preserves message metadata', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: 'question', send_date: 123, name: 'Bob' },
        { id: 'm2', role: 'assistant', content: 'answer', send_date: 456, name: 'Alice' },
      ],
      metadata: {},
    };
    const { resolver } = makeHarness(db);

    const resolved = await resolver.resolveMany([
      '{{messagecount}}',
      '{{lastmessageid}}',
      '{{lastmessage}}',
      '{{history}}',
    ], CHAT, CHAR, USER, { cbsContext: true });

    expect(resolved.slice(0, 3)).toEqual(['2', '1', 'answer']);
    const serializedHistory = JSON.parse(resolved[3] ?? '[]') as string[];
    const history = serializedHistory.map((item) => JSON.parse(item)) as Array<{
      role: string;
      data: string;
      time: number;
      speaker?: string;
    }>;
    // Index 0 is the greeting row Risu prepends to {{history}}.
    expect(history.slice(1)).toEqual([
      { role: 'user', data: 'question', time: 123, speaker: 'Bob' },
      { role: 'char', data: 'answer', time: 456, speaker: 'Alice' },
    ]);
  });

  test('position slots substitute from decorator buffers, stay literal in cbs context', async () => {
    const db: MockDb = { messages: [], metadata: {} };
    const { resolver } = makeHarness(db);
    setDecoratorBuffers(CHAT, { injectAt: [], positionPt: { VISIBLE: 'shown' } });

    // Risu's cbs() has no position function, only positionParser substitutes it.
    expect(
      await resolver.resolveMany(
        ['{{position::A}}|{{position::VISIBLE}}'],
        CHAT,
        CHAR,
        USER,
        { cbsContext: true },
      ),
    ).toEqual(['{{position::A}}|{{position::VISIBLE}}']);

    const display = await resolver.resolveInWorker(
      '{{position::A}}|{{position::VISIBLE}}',
      CHAT,
      CHAR,
      USER,
      false,
      false,
    );
    expect(display).toBe('|shown');
  });
});

describe('runVar strip pass — Risu runCurrentChatFunction parity', () => {
  test('turn 1: strips setvar/addvar, persists merged value, leaves getvar raw', async () => {
    const db: MockDb = {
      messages: [
        { id: 'g', role: 'assistant', content: 'Greeting {{setvar::never::1}}' },
        { id: 'm1', role: 'user', content: '{{setvar::hp::100}}Hello' },
        { id: 'm2', role: 'assistant', content: '{{addvar::hp::-10}}Ouch {{getvar::hp}}' },
      ],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);

    // Greeting is not part of Risu chat.message[], its setvar never runs.
    expect(db.messages[0]!.content).toBe('Greeting {{setvar::never::1}}');
    expect(db.messages[1]!.content).toBe('Hello');
    // getvar stays raw in storage so display resolves it live per render.
    expect(db.messages[2]!.content).toBe('Ouch {{getvar::hp}}');
    expect(chatVars(db)['hp']).toBe('90');
    expect(chatVars(db)['never']).toBeUndefined();
  });

  test('re-running the pass is a no-op (the strip is the dedup)', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: '{{addvar::n::1}}go' },
      ],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(chatVars(db)['n']).toBe('NaN'); // Risu: Number("null") + 1
    db.metadata = { ...db.metadata, chat_variables: { n: '5' } };
    invalidateRecentFlush(CHAT);
    await pass.run(CHAT, CHAR, USER);
    // Macro is gone, second pass must not re-add.
    expect(chatVars(db)['n']).toBe('5');
    expect(db.messages[0]!.content).toBe('go');
  });

  test('cross-turn: new message accumulates on persisted state', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: '{{setvar::hp::50}}a' },
      ],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(chatVars(db)['hp']).toBe('50');

    // Next turn arrives, restart-equivalent state (caches dropped).
    db.messages.push({ id: 'm2', role: 'assistant', content: '{{addvar::hp::25}}b' });
    invalidateRecentFlush(CHAT);
    clearVarOverlay(CHAT);
    const { pass: pass2 } = makeHarness(db);
    await pass2.run(CHAT, CHAR, USER);
    expect(chatVars(db)['hp']).toBe('75');
    expect(db.messages[1]!.content).toBe('b');
  });

  test('merges with trigger/Lua-written vars instead of clobbering', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: '{{setvar::hp::10}}x' },
      ],
      metadata: { chat_variables: { mood: 'happy' } },
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(chatVars(db)).toEqual({ mood: 'happy', hp: '10' });
  });

  test('setdefaultvar: missing and empty variables both receive defaults', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: '{{setdefaultvar::a::A}}{{setdefaultvar::b::B}}' },
      ],
      metadata: { chat_variables: { b: '' } },
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(chatVars(db)['a']).toBe('A');
    expect(chatVars(db)['b']).toBe('B');
    expect(db.messages[0]!.content).toBe('');
  });

  test('block-nested setvar stays raw (surgical-strip deviation, never persists)', async () => {
    const src = '{{#if 1}}{{setvar::z::1}}{{/if}}tail';
    const db: MockDb = {
      messages: [{ id: 'm1', role: 'user', content: src }],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(db.messages[0]!.content).toBe(src);
    expect(chatVars(db)['z']).toBeUndefined();
  });

  test('display resolve after restart reads persisted value, hides leftover setvar', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: '{{setvar::hp::42}}hi' },
      ],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);

    // Restart: fresh harness, caches dropped, only the mock DB persists.
    invalidateRecentFlush(CHAT);
    clearVarOverlay(CHAT);
    const { resolver } = makeHarness(db);
    const shown = await resolver.resolveInWorker('HP: {{getvar::hp}}', CHAT, CHAR, USER, false, true);
    expect(shown).toBe('HP: 42');
    // A not-yet-stripped setvar (e.g. mid-turn render) hides on display (rmVar).
    const midTurn = await resolver.resolveInWorker('{{setvar::hp::0}}HP: {{getvar::hp}}', CHAT, CHAR, USER, false, true);
    expect(midTurn).toBe('HP: 42');
  });

  test('field parse (no flags) leaves setvar literal, never executes (Risu prompt parity)', async () => {
    const db: MockDb = {
      messages: [{ id: 'm1', role: 'user', content: 'plain' }],
      metadata: { chat_variables: { hp: '7' } },
    };
    const { resolver } = makeHarness(db);
    const out = await resolver.resolveInWorker('{{setvar::hp::0}}HP {{getvar::hp}}', CHAT, CHAR, USER);
    expect(out).toBe('{{setvar::hp::0}}HP 7');
    expect(chatVars(db)['hp']).toBe('7');
  });

  test('no setvar family anywhere: zero writes, zero edits', async () => {
    const db: MockDb = {
      messages: [
        { id: 'm1', role: 'user', content: 'Hello {{getvar::x}} {{char}}' },
      ],
      metadata: {},
    };
    const { pass } = makeHarness(db);
    await pass.run(CHAT, CHAR, USER);
    expect(db.messages[0]!.content).toBe('Hello {{getvar::x}} {{char}}');
    expect(db.metadata['chat_variables']).toBeUndefined();
  });
});
