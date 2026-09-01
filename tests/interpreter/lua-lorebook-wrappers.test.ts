import { describe, expect, test } from 'bun:test';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';

describe('Lua lorebook wrappers', () => {
  test('getLoreBooks decodes the synchronous runtime result', async () => {
    const calls: unknown[][] = [];
    const result = await luaExecute(
      `
function probe()
  local books = getLoreBooks('safe-id', 'Inventory')
  return books[1].comment .. '|' .. books[1].content
end
`,
      {
        getLoreBooksMain: (...args: unknown[]) => {
          calls.push(args);
          return JSON.stringify([
            { comment: 'Inventory', content: 'Oak log: 3' },
          ]);
        },
      },
      { entry: 'probe' },
    );

    expect(result).toBe('Inventory|Oak log: 3');
    expect(calls).toEqual([['safe-id', 'Inventory']]);
  });

  test('loadLoreBooks awaits and decodes the asynchronous runtime result', async () => {
    const calls: unknown[][] = [];
    const result = await luaExecute(
      `
function probe()
  local books = loadLoreBooks('low-level-id')
  return books[1].role .. '|' .. books[1].data
end
`,
      {
        loadLoreBooksMain: async (...args: unknown[]) => {
          calls.push(args);
          return JSON.stringify([
            { role: 'system', data: 'Activated lore' },
          ]);
        },
      },
      { entry: 'probe' },
    );

    expect(result).toBe('system|Activated lore');
    expect(calls).toEqual([['low-level-id']]);
  });
});
