import { describe, expect, test } from 'bun:test';
import {
  withDispatchContext,
  getDispatchContext,
  type DispatchContext,
} from '../../src/interpreter/runtime/dispatch-context.js';

describe('dispatch-context', () => {
  test('outside any frame returns null', () => {
    expect(getDispatchContext()).toBe(null);
  });

  test('withDispatchContext exposes ctx via getDispatchContext', () => {
    const ctx: DispatchContext = { chatId: 'chat-1', binding: 'output' };
    const seen: Array<DispatchContext | null> = [];
    withDispatchContext(ctx, () => {
      seen.push(getDispatchContext());
    });
    expect(seen[0]).toBe(ctx);
  });

  test('frame closes automatically on return', () => {
    const ctx: DispatchContext = { chatId: 'x' };
    withDispatchContext(ctx, () => {
      expect(getDispatchContext()).toBe(ctx);
    });
    expect(getDispatchContext()).toBe(null);
  });

  test('nested withDispatchContext shadows + restores outer', () => {
    const outer: DispatchContext = { chatId: 'outer' };
    const inner: DispatchContext = { chatId: 'inner' };
    withDispatchContext(outer, () => {
      expect(getDispatchContext()).toBe(outer);
      withDispatchContext(inner, () => {
        expect(getDispatchContext()).toBe(inner);
      });
      expect(getDispatchContext()).toBe(outer);
    });
  });

  test('concurrent runs stay isolated across awaits', async () => {
    const a: DispatchContext = { chatId: 'a' };
    const b: DispatchContext = { chatId: 'b' };
    let aSawA = false;
    let bSawB = false;
    const pa = withDispatchContext(a, async () => {
      await new Promise((r) => setTimeout(r, 10));
      aSawA = getDispatchContext() === a;
    });
    const pb = withDispatchContext(b, async () => {
      await new Promise((r) => setTimeout(r, 5));
      bSawB = getDispatchContext() === b;
    });
    await Promise.all([pa, pb]);
    expect(aSawA).toBe(true);
    expect(bSawB).toBe(true);
  });
});
