import { expect, test } from 'bun:test';
import { mapLoreBook } from '../../src/core/mappers/lorebook.js';
import { loreBookSchema } from '../../src/core/schemas/lorebook.js';

test('lore priority defaults to insertion order without replacing explicit decorators', () => {
  const entries = ['', '@@priority 3\n', '@@priority 0\n'].map((prefix) =>
    loreBookSchema.parse({ key: 'pilot', content: prefix + 'Profile', insertorder: 780 }));
  const rows = mapLoreBook(entries, { worldBookId: 'book' });
  expect(rows.map((row) => row.priority)).toEqual([780, 3, 0]);
  expect(rows.map((row) => row.order_value)).toEqual([780, 780, 780]);
});
