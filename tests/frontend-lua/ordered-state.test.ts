import { expect, test } from 'bun:test';
import { OrderedRuntimeState, RuntimeStateEpochError } from '../../src/frontend-lua/ordered-state.js';

const revision = (sequence: number) => ({ epoch: 'host', sequence });
const patch = (values: Record<string, unknown>) => new Map(Object.entries(values));

test('structured values preserve identity on equal transport copies and notify actual nested edits', () => {
  const initial = { list: [1, null, { enabled: false }], label: 'same' };
  const changes: string[][] = [];
  const state = new OrderedRuntimeState(revision(0), patch({ value: initial }), keys => changes.push([...keys]));
  state.apply(revision(2), patch({ value: { label: 'same', list: [1, null, { enabled: false }] } }));
  expect(changes).toEqual([]);
  expect(state.get('value')).toBe(initial);
  state.apply(revision(1), patch({ value: { list: [] } }));
  expect(state.get('value')).toBe(initial);
  for (const [index, value] of [
    { list: [1, null, { enabled: true }], label: 'same' },
    { list: [1, { enabled: true }], label: 'same' },
    { list: [1, { enabled: true }] },
    { list: { 0: 1, 1: { enabled: true } } },
    null,
    [],
  ].entries()) {
    state.apply(revision(index + 3), patch({ value }));
    expect(state.get('value')).toEqual(value);
    expect(changes).toHaveLength(index + 1);
  }
});

test('an older acknowledgement cannot replace a subsequent local write', () => {
  const observed: unknown[] = [];
  const state = new OrderedRuntimeState(revision(0), patch({ panel: 'closed' }), () => observed.push(state.get('panel')));
  const first = state.begin(patch({ panel: 'open' }));
  const second = state.begin(patch({ panel: 'closed again' }));
  state.settle(first, revision(1), patch({ panel: 'open' }));
  state.settle(second, revision(2), patch({ panel: 'closed again' }));
  expect(observed).toEqual(['open', 'closed again']);
  state.apply(revision(1), patch({ panel: 'open' }));
  expect(state.get('panel')).toBe('closed again');
});

test('external edits after persistence win when its delayed acknowledgement arrives', () => {
  const state = new OrderedRuntimeState(revision(0), patch({ text: 'before' }), () => {});
  const write = state.begin(patch({ text: 'local' }));
  state.apply(revision(2), patch({ text: 'external' }));
  state.settle(write, revision(1), patch({ text: 'local' }));
  expect(state.get('text')).toBe('external');
});

test('a newer revision for one field does not drop an unseen edit to another field', () => {
  const state = new OrderedRuntimeState(revision(10), patch({ a: 'old', b: 'old' }), () => {});
  state.apply(revision(12), patch({ a: 'new' }));
  state.apply(revision(11), patch({ b: 'also new' }));
  state.apply(revision(9), patch({ c: 'deleted before initial snapshot' }));
  expect(state.get('a')).toBe('new');
  expect(state.get('b')).toBe('also new');
  expect(state.get('c')).toBeUndefined();
});

test('failed writes remove only their own overlay and host restarts are rejected', () => {
  const state = new OrderedRuntimeState(revision(0), patch({ a: 1 }), () => {});
  const first = state.begin(patch({ a: 2 }));
  const second = state.begin(patch({ a: 3 }));
  state.discard(first);
  expect(state.get('a')).toBe(3);
  state.discard(second);
  expect(state.get('a')).toBe(1);
  expect(() => state.apply({ epoch: 'restarted', sequence: 1 }, patch({ a: 4 }))).toThrow(RuntimeStateEpochError);
  expect(state.get('a')).toBe(1);
});
