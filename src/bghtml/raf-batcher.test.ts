import { describe, expect, test } from 'bun:test';

import { createRafBatcher, type FrameScheduler } from './raf-batcher.js';

function manualFrame(): { schedule: FrameScheduler; fire: () => void } {
  let cb: (() => void) | null = null;
  return {
    schedule: (next) => { cb = next; },
    fire: () => { const run = cb; cb = null; run?.(); },
  };
}

describe('createRafBatcher', () => {
  test('coalesces items scheduled within one frame into a single batch', () => {
    const frame = manualFrame();
    const batches: string[][] = [];
    const batcher = createRafBatcher(frame.schedule, (items) => batches.push(items));

    batcher.schedule('setStylesheet');
    batcher.schedule('setCrossRuleSheets');
    batcher.schedule('setStylesheet');
    expect(batcher.pendingCount()).toBe(2);
    expect(batches).toEqual([]);

    frame.fire();
    expect(batches).toEqual([['setStylesheet', 'setCrossRuleSheets']]);
    expect(batcher.pendingCount()).toBe(0);
  });

  test('deduplicates repeated items and preserves insertion order', () => {
    const frame = manualFrame();
    const batches: string[][] = [];
    const batcher = createRafBatcher(frame.schedule, (items) => batches.push(items));

    batcher.schedule('b');
    batcher.schedule('a');
    batcher.schedule('b');
    frame.fire();
    expect(batches).toEqual([['b', 'a']]);
  });

  test('schedules at most one frame while a batch is pending', () => {
    let framesScheduled = 0;
    const callbacks: (() => void)[] = [];
    const batcher = createRafBatcher((cb) => { framesScheduled++; callbacks.push(cb); }, () => {});

    batcher.schedule('x');
    batcher.schedule('y');
    batcher.schedule('z');
    expect(framesScheduled).toBe(1);

    callbacks[0]!();
    expect(framesScheduled).toBe(1);
    batcher.schedule('w');
    expect(framesScheduled).toBe(2);
  });

  test('flush runs the pending batch immediately without double-running', () => {
    const frame = manualFrame();
    const batches: string[][] = [];
    const batcher = createRafBatcher(frame.schedule, (items) => batches.push(items));

    batcher.schedule('only');
    batcher.flush();
    batcher.flush();
    frame.fire();
    expect(batches).toEqual([['only']]);
  });

  test('empty batch does not invoke processor', () => {
    const frame = manualFrame();
    let calls = 0;
    const batcher = createRafBatcher(frame.schedule, () => { calls++; });
    batcher.schedule('x');
    batcher.dispose();
    frame.fire();
    batcher.flush();
    expect(calls).toBe(0);
    expect(batcher.pendingCount()).toBe(0);
  });
});
