import { afterEach, expect, test } from 'bun:test';
import {
  presetToggleValues,
  recordPresetToggleValues,
  resetPresetToggleValues,
} from '../../src/state/preset-toggle-values.js';
import { mergeEffectiveGlobals, readEffectiveGlobals } from '../../src/state/toggle-preferences.js';

afterEach(() => {
  resetPresetToggleValues();
  delete (globalThis as { spindle?: unknown }).spindle;
});

test('recording keeps only scalar toggle entries and stringifies numbers', () => {
  recordPresetToggleValues('chat', 'user', 'preset-a', {
    toggle_switch: 1,
    toggle_text: 'saved',
    toggle_empty: '',
    words: 500,
    toggle_object: { nested: true },
    toggle_null: null,
  });
  expect(presetToggleValues('chat', 'user')).toEqual({
    toggle_switch: '1',
    toggle_text: 'saved',
    toggle_empty: '',
  });
});

test('an env without a preset identity keeps the snapshot and a new preset replaces it', () => {
  recordPresetToggleValues('chat', 'user', 'preset-a', { toggle_switch: 1 });
  recordPresetToggleValues('chat', 'user', undefined, undefined);
  expect(presetToggleValues('chat', 'user')).toEqual({ toggle_switch: '1' });
  recordPresetToggleValues('chat', 'user', 'preset-b', { words: 500 });
  expect(presetToggleValues('chat', 'user')).toEqual({});
});

test('snapshots are chat scoped and never cross users', () => {
  recordPresetToggleValues('chat', 'user', 'preset-a', { toggle_switch: 1 });
  expect(presetToggleValues('other-chat', 'user')).toEqual({});
  expect(presetToggleValues('chat', 'other')).toEqual({});
  expect(presetToggleValues('chat', '')).toEqual({});
});

test('overlay precedence is preset, then chat globals, then persisted preferences', () => {
  expect(
    mergeEffectiveGlobals({ ordinary: 'chat', toggle_switch: 'chat' }, null, { toggle_switch: 'preset', toggle_only: 'preset' }),
  ).toEqual({ ordinary: 'chat', toggle_switch: 'chat', toggle_only: 'preset' });
  expect(
    mergeEffectiveGlobals({ ordinary: 'chat', toggle_switch: 'chat' }, { toggle_switch: 'saved' }, {
      toggle_switch: 'preset',
      toggle_only: 'preset',
    }),
  ).toEqual({ ordinary: 'chat', toggle_switch: 'saved', toggle_only: 'preset' });
  expect(mergeEffectiveGlobals({}, {}, {})).toEqual({});
});

test('readEffectiveGlobals forwards the recorded preset values', async () => {
  (globalThis as { spindle?: unknown }).spindle = {
    userStorage: { getJson: async (_path: string, options: { fallback?: unknown }) => options.fallback ?? null },
  };
  expect(await readEffectiveGlobals('user', { ordinary: 'chat' }, { toggle_preset: '1' })).toEqual({
    ordinary: 'chat',
    toggle_preset: '1',
  });
});
