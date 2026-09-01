import { describe, expect, test } from 'bun:test';
import { buildDisplayChatState } from '../../src/state/display-snapshot-assembly.js';

describe('display snapshot chat state', () => {
  test('derives Lua and CBS history from the same fresh host rows', () => {
    const state = buildDisplayChatState([
      {
        id: 'greeting',
        role: 'assistant',
        content: 'Greeting',
        createdAt: 10,
      },
      {
        id: 'user',
        role: 'user',
        content: 'fresh user',
        createdAt: 20,
        speaker: 'Alice',
      },
      {
        id: 'assistant',
        role: 'assistant',
        content: 'fresh assistant',
        createdAt: 30,
      },
    ]);

    expect(state.messages).toEqual([
      {
        role: 'user',
        content: 'fresh user',
        createdAt: 20,
        speaker: 'Alice',
      },
      {
        role: 'assistant',
        content: 'fresh assistant',
        createdAt: 30,
      },
    ]);
    expect(state.messageCount).toBe(3);
    expect(state.lastMessageId).toBe(2);
    expect(state.lastMessage).toBe('fresh assistant');
    expect(state.lastUserMessage).toBe('fresh user');
    expect(state.lastCharMessage).toBe('fresh assistant');
  });

  test('drops the host streaming placeholder just like the Lua chat view', () => {
    const state = buildDisplayChatState([
      { id: 'greeting', role: 'assistant', content: 'Greeting' },
      { id: 'user', role: 'user', content: 'craft' },
      { id: 'placeholder', role: 'assistant', content: '' },
    ]);

    expect(state.messages).toEqual([
      { role: 'user', content: 'craft', createdAt: 0 },
    ]);
    expect(state.messageCount).toBe(2);
    expect(state.lastMessageId).toBe(1);
    expect(state.lastMessage).toBe('craft');
    expect(state.lastCharMessage).toBe('');
  });
});
