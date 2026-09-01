/**
 * Unit tests for the own-CHAT_CHANGED counter.
 *
 * `spindle.chats.update` always emits CHAT_CHANGED (Lumi
 * chats.service.ts:288). To distinguish our own writes from external
 * ones (Lumi-native commit-mode `{{setvar}}`, REST PUT, theme swap,
 * other extensions), we increment a per-chat counter before each of
 * our own updates; the CHAT_CHANGED handler decrements + skips
 * refresh when counter > 0, refreshes when counter == 0.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  expectChatChange,
  consumeOwnChatChange,
  resetOwnChatChangeTracking,
  pendingOwnChatChanges,
} from '../../src/state/own-chat-change.js';

beforeEach(() => resetOwnChatChangeTracking());

describe('own-chat-change tracker', () => {
  test('empty counter: consumeOwnChatChange returns false (treats as external)', () => {
    expect(consumeOwnChatChange('chat-1')).toBe(false);
  });

  test('increment + consume: returns true (our own), counter zero after', () => {
    expectChatChange('chat-1');
    expect(pendingOwnChatChanges('chat-1')).toBe(1);
    expect(consumeOwnChatChange('chat-1')).toBe(true);
    expect(pendingOwnChatChanges('chat-1')).toBe(0);
  });

  test('multiple increments queue, drained one by one', () => {
    expectChatChange('chat-1');
    expectChatChange('chat-1');
    expectChatChange('chat-1');
    expect(pendingOwnChatChanges('chat-1')).toBe(3);
    expect(consumeOwnChatChange('chat-1')).toBe(true);
    expect(consumeOwnChatChange('chat-1')).toBe(true);
    expect(consumeOwnChatChange('chat-1')).toBe(true);
    expect(consumeOwnChatChange('chat-1')).toBe(false); // 4th = external
  });

  test('per-chat scoping: chat-A increment doesn t consume from chat-B', () => {
    expectChatChange('chat-A');
    expect(consumeOwnChatChange('chat-B')).toBe(false);
    expect(pendingOwnChatChanges('chat-A')).toBe(1);
    expect(consumeOwnChatChange('chat-A')).toBe(true);
  });

  test('over-consume returns false but doesn t go negative', () => {
    expectChatChange('chat-1');
    expect(consumeOwnChatChange('chat-1')).toBe(true);
    expect(consumeOwnChatChange('chat-1')).toBe(false);
    expect(consumeOwnChatChange('chat-1')).toBe(false);
    expect(pendingOwnChatChanges('chat-1')).toBe(0);
  });

  test('interleaved: own + external in mixed order', () => {
    // Our trigger fires 2 chat updates; external one happens between them
    // → ordering of CHAT_CHANGED arrivals could go own-own-external OR
    // own-external-own depending on Lumi's emit order. Our discriminator
    // can't tell these apart by event payload — we just count.
    //
    // The test asserts the count drains correctly regardless of arrival
    // order. The slight race (skip vs refresh) is documented as
    // acceptable.
    expectChatChange('chat-1'); // own #1 issued
    expectChatChange('chat-1'); // own #2 issued
    // Lumi emits 3 CHAT_CHANGEDs (2 ours + 1 external in some order).
    // Our handler processes them sequentially:
    expect(consumeOwnChatChange('chat-1')).toBe(true);  // counted as own
    expect(consumeOwnChatChange('chat-1')).toBe(true);  // counted as own
    expect(consumeOwnChatChange('chat-1')).toBe(false); // external (or same)
  });

  test('counter survives between unrelated tests via beforeEach reset', () => {
    expect(pendingOwnChatChanges('chat-1')).toBe(0);
    expect(pendingOwnChatChanges('chat-2')).toBe(0);
  });
});
