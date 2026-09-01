/**
 * Pin pure trigger-lua replace helpers. Mutation strategy:
 *   - Empty newCode removes ALL triggerlua effects.
 *   - Non-empty newCode replaces the FIRST triggerlua's code,
 *     drops subsequent triggerlua entries (collapses multi-lua).
 *   - When the trigger had no triggerlua AND newCode is non-empty:
 *     append a single triggerlua at the end.
 * Non-triggerlua effects always stay in their original order.
 */

import { describe, test, expect } from 'bun:test';
import {
  extractLuaForTrigger,
  replaceTriggerLua,
  replaceTriggerLuaInArray,
} from '../../src/state/trigger-lua-mutate.js';

describe('replaceTriggerLua — single trigger replacement', () => {
  test('replaces existing single triggerlua code in place', () => {
    const t = {
      type: 'manual',
      comment: 'btn',
      effect: [{ type: 'triggerlua', code: 'old' }],
    };
    const r = replaceTriggerLua(t, 'new');
    expect(r.ok).toBe(true);
    expect(r.trigger!.effect).toEqual([{ type: 'triggerlua', code: 'new' }]);
  });

  test('preserves comment + type + non-effect keys', () => {
    const t = {
      type: 'manual',
      comment: 'my button',
      ext: { custom: 'value' },
      effect: [{ type: 'triggerlua', code: 'old' }],
    };
    const r = replaceTriggerLua(t, 'new');
    expect(r.trigger!.type).toBe('manual');
    expect(r.trigger!.comment).toBe('my button');
    expect((r.trigger as { ext?: unknown }).ext).toEqual({ custom: 'value' });
  });

  test('preserves non-triggerlua effects in order, replaces lua at first triggerlua position', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'v2SetVar', name: 'x', value: 1 },
        { type: 'triggerlua', code: 'old' },
        { type: 'v2SetVar', name: 'y', value: 2 },
      ],
    };
    const r = replaceTriggerLua(t, 'new');
    expect(r.trigger!.effect).toEqual([
      { type: 'v2SetVar', name: 'x', value: 1 },
      { type: 'triggerlua', code: 'new' },
      { type: 'v2SetVar', name: 'y', value: 2 },
    ]);
  });

  test('collapses MULTIPLE triggerlua effects into one (replaces first, drops rest)', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'triggerlua', code: 'first' },
        { type: 'v2SetVar', name: 'x', value: 1 },
        { type: 'triggerlua', code: 'second' },
        { type: 'triggerlua', code: 'third' },
      ],
    };
    const r = replaceTriggerLua(t, 'merged');
    expect(r.trigger!.effect).toEqual([
      { type: 'triggerlua', code: 'merged' },
      { type: 'v2SetVar', name: 'x', value: 1 },
    ]);
  });

  test('empty newCode removes ALL triggerlua effects (including when there are multiple)', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'v2SetVar' },
        { type: 'triggerlua', code: 'a' },
        { type: 'triggerlua', code: 'b' },
      ],
    };
    const r = replaceTriggerLua(t, '');
    expect(r.trigger!.effect).toEqual([{ type: 'v2SetVar' }]);
  });

  test('appends triggerlua when trigger had none and newCode is non-empty', () => {
    const t = {
      type: 'manual',
      effect: [{ type: 'v2SetVar' }],
    };
    const r = replaceTriggerLua(t, 'fresh');
    expect(r.trigger!.effect).toEqual([
      { type: 'v2SetVar' },
      { type: 'triggerlua', code: 'fresh' },
    ]);
  });

  test('no-op append when trigger had none and newCode is empty', () => {
    const t = {
      type: 'manual',
      effect: [{ type: 'v2SetVar' }],
    };
    const r = replaceTriggerLua(t, '');
    expect(r.trigger!.effect).toEqual([{ type: 'v2SetVar' }]);
  });

  test('refuses non-object trigger', () => {
    expect(replaceTriggerLua(null, 'x').ok).toBe(false);
    expect(replaceTriggerLua(undefined, 'x').ok).toBe(false);
    expect(replaceTriggerLua('string', 'x').ok).toBe(false);
    expect(replaceTriggerLua(42, 'x').ok).toBe(false);
  });

  test('handles trigger with no effect array', () => {
    const t = { type: 'manual', comment: 'no-effects' };
    const r = replaceTriggerLua(t, 'add-this');
    expect(r.ok).toBe(true);
    expect(r.trigger!.effect).toEqual([{ type: 'triggerlua', code: 'add-this' }]);
  });

  test('does not mutate the input trigger', () => {
    const t = { type: 'manual', effect: [{ type: 'triggerlua', code: 'old' }] };
    const snap = JSON.stringify(t);
    replaceTriggerLua(t, 'new');
    expect(JSON.stringify(t)).toBe(snap);
  });

  test('preserves any extra keys on the triggerlua effect itself', () => {
    const t = {
      type: 'manual',
      effect: [{ type: 'triggerlua', code: 'old', metadata: { author: 'x' } }],
    };
    const r = replaceTriggerLua(t, 'new');
    const firstEffect = r.trigger!.effect?.[0];
    expect(firstEffect).toEqual({
      type: 'triggerlua',
      code: 'new',
      metadata: { author: 'x' },
    });
  });
});

describe('replaceTriggerLuaInArray — array indexing', () => {
  test('mutates the trigger at the given index, leaves others untouched', () => {
    const triggers = [
      { type: 'manual', comment: 'a', effect: [{ type: 'triggerlua', code: 'A1' }] },
      { type: 'manual', comment: 'b', effect: [{ type: 'triggerlua', code: 'B1' }] },
      { type: 'manual', comment: 'c', effect: [{ type: 'triggerlua', code: 'C1' }] },
    ];
    const r = replaceTriggerLuaInArray(triggers, 1, 'B2');
    expect(r.ok).toBe(true);
    expect(r.triggers!.length).toBe(3);
    // Original triggers untouched.
    expect(r.triggers![0]).toBe(triggers[0]);
    expect(r.triggers![2]).toBe(triggers[2]);
    expect(extractLuaForTrigger(r.triggers![1])).toBe('B2');
  });

  test('refuses out-of-range index', () => {
    const triggers = [{ type: 'manual', effect: [] }];
    expect(replaceTriggerLuaInArray(triggers, -1, 'x').ok).toBe(false);
    expect(replaceTriggerLuaInArray(triggers, 1, 'x').ok).toBe(false);
    expect(replaceTriggerLuaInArray(triggers, 99, 'x').ok).toBe(false);
  });

  test('refuses non-array input', () => {
    expect(replaceTriggerLuaInArray('not-array' as unknown as readonly unknown[], 0, 'x').ok).toBe(false);
  });

  test('does not mutate the input array', () => {
    const triggers = [{ type: 'manual', effect: [{ type: 'triggerlua', code: 'old' }] }];
    const snap = JSON.stringify(triggers);
    replaceTriggerLuaInArray(triggers, 0, 'new');
    expect(JSON.stringify(triggers)).toBe(snap);
  });
});

describe('extractLuaForTrigger — sync re-derive', () => {
  test('concatenates all triggerlua codes in order with newlines', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'triggerlua', code: 'a' },
        { type: 'v2SetVar' },
        { type: 'triggerlua', code: 'b' },
      ],
    };
    expect(extractLuaForTrigger(t)).toBe('a\nb');
  });

  test('returns empty string when trigger has no triggerlua', () => {
    expect(extractLuaForTrigger({ type: 'manual', effect: [{ type: 'v2SetVar' }] })).toBe('');
  });

  test('returns empty string for non-object input', () => {
    expect(extractLuaForTrigger(null)).toBe('');
    expect(extractLuaForTrigger(undefined)).toBe('');
  });

  test('skips triggerlua entries with non-string code', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'triggerlua', code: 'kept' },
        { type: 'triggerlua' }, // missing code
        { type: 'triggerlua', code: 42 }, // wrong type
      ],
    };
    expect(extractLuaForTrigger(t)).toBe('kept');
  });
});

describe('replace + extract roundtrip', () => {
  test('replace then extract returns the new code', () => {
    const t = { type: 'manual', effect: [{ type: 'triggerlua', code: 'old' }] };
    const r = replaceTriggerLua(t, 'fresh-content');
    expect(extractLuaForTrigger(r.trigger)).toBe('fresh-content');
  });

  test('replace with empty then extract returns ""', () => {
    const t = { type: 'manual', effect: [{ type: 'triggerlua', code: 'old' }] };
    const r = replaceTriggerLua(t, '');
    expect(extractLuaForTrigger(r.trigger)).toBe('');
  });

  test('multi-lua collapse + extract returns just the merged code', () => {
    const t = {
      type: 'manual',
      effect: [
        { type: 'triggerlua', code: 'first' },
        { type: 'triggerlua', code: 'second' },
      ],
    };
    const r = replaceTriggerLua(t, 'merged');
    expect(extractLuaForTrigger(r.trigger)).toBe('merged');
  });
});
