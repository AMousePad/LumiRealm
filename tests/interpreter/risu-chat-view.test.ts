/**
 * Risu chat-shape adapter — pins the contract for trigger-time chat shape
 * to concrete scenarios. When a future Lumi optimization shifts chat shape
 * in a new way, adding a new adjustment HERE (with a test case) is the
 * intended workflow — vs. discovering the bug at runtime.
 */

import { describe, test, expect } from 'bun:test';
import { buildRisuChatView } from '../../src/interpreter/risu-chat-view.js';
import type { HostMessage } from '../../src/interpreter/host.js';

function userMsg(id: string, content: string): HostMessage {
  return { id, role: 'user', content };
}
function asstMsg(id: string, content: string): HostMessage {
  return { id, role: 'assistant', content };
}

describe('buildRisuChatView', () => {
  test('empty input returns empty output, no adjustments', () => {
    const r = buildRisuChatView({ messages: [] });
    expect(r.messages).toEqual([]);
    expect(r.adjustments).toEqual([]);
  });

  test('single user message passes through unchanged (no greeting to strip)', () => {
    const msgs = [userMsg('u1', 'hello')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual(msgs);
    expect(r.adjustments).toEqual([]);
  });

  test('Adjustment 2: greeting + user drops the greeting (Risu chat.message frame)', () => {
    const msgs = [asstMsg('g', 'Hello, traveller.'), userMsg('u1', '.')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([userMsg('u1', '.')]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
    expect(r.greeting).toBe('Hello, traveller.');
  });

  test('Adjustment 2: no greeting field when nothing stripped', () => {
    const r = buildRisuChatView({ messages: [userMsg('u0', 'hi'), asstMsg('a0', 'yo')] });
    expect(r.greeting).toBeUndefined();
  });

  test('Adjustment 2: greeting-only chat collapses to empty (fresh chat, getChatLength=0)', () => {
    const msgs = [asstMsg('greeting', 'Welcome.')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
  });

  test('Adjustment 2: only the FIRST leading non-user message is dropped', () => {
    const msgs = [asstMsg('greeting', 'Welcome.'), asstMsg('a0', 'reply'), userMsg('u1', 'hi')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([asstMsg('a0', 'reply'), userMsg('u1', 'hi')]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
  });

  test('Adjustment 2: a user-first chat keeps its first message', () => {
    const msgs = [userMsg('u0', 'hello'), asstMsg('a0', 'world')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual(msgs);
    expect(r.adjustments).toEqual([]);
  });

  test('Adjustment 1: strips trailing empty assistant (Lumi 2b1ae51 staged placeholder)', () => {
    const msgs = [
      asstMsg('greeting', 'Welcome.'),
      userMsg('u1', '.'),
      asstMsg('staged', ''),
    ];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([userMsg('u1', '.')]);
    expect(r.adjustments).toEqual([
      'stripped:1-trailing-empty-assistant',
      'stripped:1-leading-greeting',
    ]);
  });

  test('Adjustment 1: strips multiple trailing empty assistants', () => {
    const msgs = [
      asstMsg('greeting', 'Welcome.'),
      userMsg('u1', '.'),
      asstMsg('crash-leftover', ''),
      asstMsg('staged', ''),
    ];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages.length).toBe(1);
    expect(r.messages[0]!.id).toBe('u1');
    expect(r.adjustments).toEqual([
      'stripped:2-trailing-empty-assistant',
      'stripped:1-leading-greeting',
    ]);
  });

  test('Adjustment 1: does NOT strip mid-list empty assistant', () => {
    const msgs = [
      asstMsg('greeting', 'Welcome.'),
      asstMsg('mid-empty', ''),
      userMsg('u1', '.'),
    ];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([asstMsg('mid-empty', ''), userMsg('u1', '.')]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
  });

  test('Adjustment 1: does NOT strip non-empty trailing assistant', () => {
    const msgs = [
      asstMsg('greeting', 'Welcome.'),
      userMsg('u1', 'hello'),
      asstMsg('reply', 'world'),
    ];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([userMsg('u1', 'hello'), asstMsg('reply', 'world')]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
  });

  test('Adjustment 1: does NOT strip trailing user message', () => {
    const msgs = [
      asstMsg('greeting', 'Welcome.'),
      asstMsg('reply', 'world'),
      userMsg('u-empty', ''),
    ];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages).toEqual([asstMsg('reply', 'world'), userMsg('u-empty', '')]);
    expect(r.adjustments).toEqual(['stripped:1-leading-greeting']);
  });

  test('returns DEFENSIVE COPY — output messages are not the same objects as input', () => {
    const msgs = [userMsg('u1', 'hello')];
    const r = buildRisuChatView({ messages: msgs });
    expect(r.messages[0]).not.toBe(msgs[0]);
    expect(r.messages[0]).toEqual(msgs[0]);
  });
});
