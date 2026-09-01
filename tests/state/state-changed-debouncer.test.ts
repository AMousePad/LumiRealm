/**
 * Per-chat debounced refresh scheduler. Pin:
 *   - debounce window coalesces multiple signals into one call
 *   - per-chat isolation (chat A doesn't delay chat B)
 *   - error in handler doesn't kill the timer infrastructure
 *   - resetStateChangedDebouncer drops pending without firing
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  scheduleStateChangedRefresh,
  pendingStateChangedTimers,
  resetStateChangedDebouncer,
  STATE_CHANGED_DEBOUNCE_MS,
} from '../../src/state/state-changed-debouncer.js';

beforeEach(() => resetStateChangedDebouncer());

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

describe('state-changed-debouncer: coalescing + isolation', () => {
  test(`debounce window is ${STATE_CHANGED_DEBOUNCE_MS}ms`, () => {
    expect(STATE_CHANGED_DEBOUNCE_MS).toBe(50);
  });

  test('single schedule fires the handler exactly once after the window', async () => {
    let calls = 0;
    scheduleStateChangedRefresh('chat-1', () => { calls += 1; });
    expect(calls).toBe(0); // not yet
    expect(pendingStateChangedTimers()).toBe(1);
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(calls).toBe(1);
    expect(pendingStateChangedTimers()).toBe(0);
  });

  test('rapid burst of N schedules within window collapses to ONE handler call', async () => {
    let calls = 0;
    for (let i = 0; i < 10; i++) {
      scheduleStateChangedRefresh('chat-1', () => { calls += 1; });
    }
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(calls).toBe(1);
  });

  test('per-chat isolation: schedules on chat-A and chat-B fire INDEPENDENTLY', async () => {
    let aCalls = 0;
    let bCalls = 0;
    scheduleStateChangedRefresh('chat-A', () => { aCalls += 1; });
    scheduleStateChangedRefresh('chat-B', () => { bCalls += 1; });
    expect(pendingStateChangedTimers()).toBe(2);
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
  });

  test('after handler fires, a fresh schedule for the same chat works again', async () => {
    let calls = 0;
    scheduleStateChangedRefresh('chat-1', () => { calls += 1; });
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(calls).toBe(1);
    scheduleStateChangedRefresh('chat-1', () => { calls += 1; });
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(calls).toBe(2);
  });

  test('handler captured at scheduling time (not at firing time) — closure stability', async () => {
    // First schedule registers handler A. Second schedule within the
    // window is a no-op (coalesced); handler A still fires. The B
    // closure provided to the no-op call is silently dropped.
    const used: string[] = [];
    scheduleStateChangedRefresh('chat-1', () => { used.push('A'); });
    scheduleStateChangedRefresh('chat-1', () => { used.push('B'); });
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(used).toEqual(['A']);
  });
});

describe('state-changed-debouncer: error handling', () => {
  test('handler throws → onError invoked, timer cleaned up, next schedule works', async () => {
    let firstFired = false;
    let onErrFired = false;
    let secondFired = false;
    scheduleStateChangedRefresh(
      'chat-1',
      () => { firstFired = true; throw new Error('boom'); },
      () => { onErrFired = true; },
    );
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(firstFired).toBe(true);
    expect(onErrFired).toBe(true);
    expect(pendingStateChangedTimers()).toBe(0);
    // Subsequent schedule unaffected:
    scheduleStateChangedRefresh('chat-1', () => { secondFired = true; });
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(secondFired).toBe(true);
  });

  test('async handler rejecting → onError invoked', async () => {
    let onErrFired = false;
    scheduleStateChangedRefresh(
      'chat-1',
      async () => { throw new Error('async boom'); },
      () => { onErrFired = true; },
    );
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(onErrFired).toBe(true);
  });
});

describe('state-changed-debouncer: reset', () => {
  test('resetStateChangedDebouncer drops pending without firing', async () => {
    let calls = 0;
    scheduleStateChangedRefresh('chat-1', () => { calls += 1; });
    scheduleStateChangedRefresh('chat-2', () => { calls += 1; });
    expect(pendingStateChangedTimers()).toBe(2);
    resetStateChangedDebouncer();
    expect(pendingStateChangedTimers()).toBe(0);
    await wait(STATE_CHANGED_DEBOUNCE_MS + 30);
    expect(calls).toBe(0); // never fired
  });
});
