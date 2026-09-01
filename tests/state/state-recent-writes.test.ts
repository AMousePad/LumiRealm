/**
 * Self-echo discrimination cache for `spindle.chat.updateMessage`
 * writes. Pin the LRU + TTL + one-shot semantics.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  rememberOurWrite,
  consumeIfOurWrite,
  resetRecentWrites,
  recentWritesSize,
  RECENT_WRITES_TTL_MS,
  RECENT_WRITES_MAX,
} from '../../src/state/recent-writes.js';

beforeEach(() => resetRecentWrites());

describe('recent-writes: basic round-trip', () => {
  test('remember + consume returns true on exact match (one-shot)', () => {
    rememberOurWrite('chat-1', 'msg-1', 'hello');
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'hello')).toBe(true);
    // Second call: entry was consumed, no longer matches.
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'hello')).toBe(false);
  });

  test('content mismatch returns false, entry NOT consumed (caller can re-check after revising guess)', () => {
    rememberOurWrite('chat-1', 'msg-1', 'expected');
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'different')).toBe(false);
    // Original entry still there:
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'expected')).toBe(true);
  });

  test('chatId mismatch is independent (not consumed by wrong chat)', () => {
    rememberOurWrite('chat-A', 'msg-1', 'X');
    expect(consumeIfOurWrite('chat-B', 'msg-1', 'X')).toBe(false);
    expect(consumeIfOurWrite('chat-A', 'msg-1', 'X')).toBe(true);
  });

  test('msgId mismatch is independent', () => {
    rememberOurWrite('chat-1', 'msg-A', 'X');
    expect(consumeIfOurWrite('chat-1', 'msg-B', 'X')).toBe(false);
    expect(consumeIfOurWrite('chat-1', 'msg-A', 'X')).toBe(true);
  });

  test('unknown key returns false cleanly', () => {
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'X')).toBe(false);
  });
});

describe('recent-writes: TTL expiration', () => {
  test('TTL constant is 60s (pinned for spec doc)', () => {
    expect(RECENT_WRITES_TTL_MS).toBe(60_000);
  });

  test('consume after TTL: returns false + drops the entry', () => {
    rememberOurWrite('chat-1', 'msg-1', 'X');
    expect(recentWritesSize()).toBe(1);
    // Synthesize a stale entry by mutating the cache via re-write
    // with an artificially old timestamp. The module doesn't expose
    // a direct way, so we rely on Date.now() time travel via a
    // monkey-patch (Bun-friendly).
    const realNow = Date.now;
    Date.now = () => realNow() + RECENT_WRITES_TTL_MS + 1;
    try {
      expect(consumeIfOurWrite('chat-1', 'msg-1', 'X')).toBe(false);
    } finally {
      Date.now = realNow;
    }
    // Entry was deleted on miss-due-to-TTL.
    expect(recentWritesSize()).toBe(0);
  });
});

describe('recent-writes: LRU + bounded size', () => {
  test(`MAX cap is ${RECENT_WRITES_MAX} (pinned for spec doc)`, () => {
    expect(RECENT_WRITES_MAX).toBe(100);
  });

  test('writes beyond MAX evict oldest by ts', () => {
    // Simulate ts ordering: write 100 entries with monotonically
    // increasing fake timestamps. The 101st should drop the oldest.
    const realNow = Date.now;
    let ts = 1_000_000;
    Date.now = () => ts;
    try {
      for (let i = 0; i < RECENT_WRITES_MAX; i++) {
        ts += 1; // increasing
        rememberOurWrite('chat-1', `msg-${i}`, `c-${i}`);
      }
      expect(recentWritesSize()).toBe(RECENT_WRITES_MAX);
      ts += 1000;
      rememberOurWrite('chat-1', 'msg-new', 'NEW');
      // Oldest (msg-0) should be evicted; latest still present.
      expect(consumeIfOurWrite('chat-1', 'msg-0', 'c-0')).toBe(false);
      expect(consumeIfOurWrite('chat-1', 'msg-new', 'NEW')).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  test('TTL-expired entries are dropped first when evicting', () => {
    const realNow = Date.now;
    let ts = 1_000_000;
    Date.now = () => ts;
    try {
      // 100 entries, all stale (older than TTL).
      for (let i = 0; i < RECENT_WRITES_MAX; i++) {
        rememberOurWrite('chat-1', `stale-${i}`, `c-${i}`);
      }
      // Time-jump past TTL.
      ts += RECENT_WRITES_TTL_MS + 1;
      // New write should clear stale entries first, leaving room.
      rememberOurWrite('chat-1', 'fresh', 'FRESH');
      // Most stale entries dropped; cap should be much lower than max now.
      expect(recentWritesSize()).toBeLessThan(RECENT_WRITES_MAX);
    } finally {
      Date.now = realNow;
    }
  });
});

describe('recent-writes: realistic resolveAndPersist round-trip', () => {
  test('write → MESSAGE_EDITED echo with our content → consumed (no re-resolve loop)', () => {
    // Simulates: resolveAndPersist writes resolved content, Lumi
    // emits MESSAGE_EDITED back to us, our handler calls
    // consumeIfOurWrite — match → skip.
    const resolved = '<div>panel: bora_c=250</div>';
    rememberOurWrite('chat-1', 'msg-1', resolved);
    // Lumi-side broadcast arrives:
    expect(consumeIfOurWrite('chat-1', 'msg-1', resolved)).toBe(true);
    // If Lumi double-fires (shouldn't, but probe), the 2nd is treated
    // as a real edit:
    expect(consumeIfOurWrite('chat-1', 'msg-1', resolved)).toBe(false);
  });

  test('user edits to byte-identical content within TTL: false-positive (documented limitation)', () => {
    const text = 'text';
    rememberOurWrite('chat-1', 'msg-1', text);
    // User edits to the exact same string. We classify as our echo
    // (false positive — documented in module doc).
    expect(consumeIfOurWrite('chat-1', 'msg-1', text)).toBe(true);
    // The next genuine edit gets through cleanly:
    expect(consumeIfOurWrite('chat-1', 'msg-1', 'new-text')).toBe(false);
  });
});
