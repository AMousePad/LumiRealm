import { describe, expect, test } from 'bun:test';
import { ToggleStateStore } from '../../src/state/toggle-state.js';
import type { AttributionWire, SidebarToggleWire } from '../../src/types/messages.js';

const A: SidebarToggleWire = { type: 'checkbox', key: 'a', value: 'A', options: [] };
const B: SidebarToggleWire = { type: 'select', key: 'b', value: 'B', options: ['x', 'y'] };
const M1: AttributionWire = { name: 'Module One', moduleId: 'mod-1' };
const M2: AttributionWire = { name: 'Module Two', moduleId: 'mod-2' };

describe('ToggleStateStore', () => {
  test('first apply → changed=true, seq=1', () => {
    const store = new ToggleStateStore();
    const r = store.applySnapshot('chat-1', [A], { a: M1 });
    expect(r.changed).toBe(true);
    expect(r.entry.seq).toBe(1);
    expect(r.entry.toggles).toEqual([A]);
    expect(r.entry.attribution).toEqual({ a: M1 });
  });

  test('identical re-apply → changed=false, same seq', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], {});
    const r = store.applySnapshot('chat-1', [A], {});
    expect(r.changed).toBe(false);
    expect(r.entry.seq).toBe(1);
  });

  test('different toggles → changed=true, seq increments', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], {});
    const r = store.applySnapshot('chat-1', [A, B], {});
    expect(r.changed).toBe(true);
    expect(r.entry.seq).toBe(2);
  });

  test('attribution change with same toggles → changed=true (DSL re-source)', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], { a: M1 });
    const r = store.applySnapshot('chat-1', [A], { a: M2 });
    expect(r.changed).toBe(true);
  });

  test('toggle reordering → changed=true (DSL order matters for groups)', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A, B], {});
    const r = store.applySnapshot('chat-1', [B, A], {});
    expect(r.changed).toBe(true);
  });

  test('attribution key reordering → changed=false (sorted in signature)', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], { a: M1, b: M2 });
    const r = store.applySnapshot('chat-1', [A], { b: M2, a: M1 });
    expect(r.changed).toBe(false);
  });

  test('separate chats → independent seqs', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], {});
    store.applySnapshot('chat-1', [B], {}); // seq=2
    const r = store.applySnapshot('chat-2', [A], {}); // first for chat-2
    expect(r.entry.seq).toBe(1);
  });

  test('clearChat drops state; next apply restarts seq=1', () => {
    const store = new ToggleStateStore();
    store.applySnapshot('chat-1', [A], {});
    store.applySnapshot('chat-1', [B], {});
    store.clearChat('chat-1');
    const r = store.applySnapshot('chat-1', [A], {});
    expect(r.entry.seq).toBe(1);
    expect(store.current('chat-1')?.toggles).toEqual([A]);
  });

  test('current returns null for unknown chat', () => {
    const store = new ToggleStateStore();
    expect(store.current('nope')).toBeNull();
  });

  test('input arrays are not aliased — mutating CALLER input does not corrupt store', () => {
    const store = new ToggleStateStore();
    const callerInput: SidebarToggleWire[] = [
      { type: 'select', key: 'b', value: 'B', options: ['x', 'y'] },
    ];
    store.applySnapshot('chat-1', callerInput, {});
    // Mutate caller's array — should not affect what's stored.
    (callerInput[0] as unknown as { options: string[] }).options.push('zzz');
    callerInput.push(A);
    const cur = store.current('chat-1');
    expect(cur?.toggles).toHaveLength(1);
    expect((cur?.toggles[0] as unknown as { options: readonly string[] }).options).toEqual(['x', 'y']);
  });
});
