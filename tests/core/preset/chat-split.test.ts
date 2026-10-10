import { expect, test } from 'bun:test';
import { TranslationError } from '../../../src/core/errors';
import { translateRisuPromptBlocks } from '../../../src/core/preset/risup-translator';

const placement = (template: Record<string, unknown>[]) =>
  translateRisuPromptBlocks(template, []).blocks.map((b) => [b.name, b.position, b.depth, b.marker]);

test('places items between Risu chat items inside the history where the earlier slice ends', () => {
  expect(placement([
    { type: 'plain', role: 'system', name: 'Before', text: 'before' },
    { type: 'chat', name: 'Older', rangeStart: 0, rangeEnd: -6 },
    { type: 'plain', role: 'system', name: 'Main', text: 'main' },
    { type: 'chat', name: 'Middle', rangeStart: -6, rangeEnd: -4 },
    { type: 'description', name: 'Card' },
    { type: 'jailbreak', name: 'Note', text: 'note' },
    { type: 'chat', name: 'Latest', rangeStart: -4, rangeEnd: 'end' },
    { type: 'plain', role: 'bot', name: 'After', text: 'after' },
  ])).toEqual([
    ['Before', 'pre_history', 0, null],
    ['Older', 'in_history', 0, 'chat_history'],
    ['Main', 'in_history', 6, null],
    ['Card', 'in_history', 4, 'char_description'],
    ['Note', 'in_history', 4, 'jailbreak'],
    ['After', 'post_history', 0, null],
  ]);
});

test('places a Risu lorebook item between chat items inside the history', () => {
  expect(placement([
    { type: 'lorebook', name: 'Lore Before' },
    { type: 'chat', name: 'Older', rangeStart: 0, rangeEnd: -6 },
    { type: 'lorebook', name: 'Lore Between' },
    { type: 'chat', name: 'Latest', rangeStart: -6, rangeEnd: 'end' },
    { type: 'lorebook', name: 'Lore After' },
  ])).toEqual([
    ['Lore Before', 'pre_history', 0, 'world_info_before'],
    ['Older', 'in_history', 0, 'chat_history'],
    ['Lore Between', 'in_history', 6, 'world_info_before'],
    ['Lore After', 'post_history', 0, 'world_info_before'],
  ]);
});

test('reads missing Risu chat bounds and the -1000 start as Risu slices them', () => {
  expect(placement([
    { type: 'chat', name: 'Older', rangeEnd: -2 },
    { type: 'plain', role: 'system', name: 'Between', text: 'between' },
    { type: 'chat', name: 'Latest', rangeStart: -2 },
  ])).toEqual([
    ['Older', 'in_history', 0, 'chat_history'],
    ['Between', 'in_history', 2, null],
  ]);
  expect(placement([
    { type: 'chat', name: 'All', rangeStart: -1000, rangeEnd: 3 },
    { type: 'plain', role: 'system', name: 'After', text: 'after' },
  ])).toEqual([
    ['All', 'in_history', 0, 'chat_history'],
    ['After', 'post_history', 0, null],
  ]);
});

test('keeps items after a gap between Risu chat items at the earlier slice end', () => {
  expect(placement([
    { type: 'chat', name: 'Older', rangeStart: 0, rangeEnd: -6 },
    { type: 'plain', role: 'system', name: 'Between', text: 'between' },
    { type: 'chat', name: 'Latest', rangeStart: -4, rangeEnd: 'end' },
  ])).toEqual([
    ['Older', 'in_history', 0, 'chat_history'],
    ['Between', 'in_history', 6, null],
  ]);
});

for (const template of [
  [{ type: 'chat', rangeStart: 2, rangeEnd: 'end' }],
  [{ type: 'chat', rangeStart: 0, rangeEnd: 3 }],
  [{ type: 'chat', rangeStart: 0, rangeEnd: 0 }],
  [{ type: 'chat', rangeStart: -2, rangeEnd: -4 }],
  [{ type: 'chat' }, { type: 'chat', rangeStart: -2, rangeEnd: 'end' }],
  [{ type: 'chat', rangeStart: -4, rangeEnd: 'end' }, { type: 'chat', rangeStart: 0, rangeEnd: -4 }],
]) {
  test(`rejects Risu chat ranges one host history cannot express: ${JSON.stringify(template)}`, () => {
    let error: unknown;
    try {
      translateRisuPromptBlocks(template, []);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(TranslationError);
    expect((error as TranslationError).kind).toBe('risup/unsupported_chat_range');
  });
}
