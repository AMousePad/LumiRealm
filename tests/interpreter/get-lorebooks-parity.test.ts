import { expect, test } from 'bun:test';
import { captureLuaRuntime, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

async function fixture() {
  const host = makeLuaDivergenceHost();
  host.preloaded.lorebook.entries[0] = { ...host.preloaded.lorebook.entries[0]!, content: 'Item {{char}}|{{getvar::x}}' };
  return captureLuaRuntime({ preloaded: host.preloaded, templateContext: async () => ({ variables: {}, character: {}, chat: {}, commit: false, chatId: 'test-chat', charName: 'Character', userName: 'User' }) });
}

test('getLoreBooks parses identity and live variables with the Lua CBS context', async () => {
  const host = await fixture();
  await host.call('setChatVar', 'x', '7');
  const books = JSON.parse(String(await host.call('getLoreBooksMain', 'Inventory')));
  expect(books[0].content).toBe('Item Character|7');
});

test('getLoreBooks only matches an exact comment, including whitespace and empty text', async () => {
  const host = await fixture();
  for (const search of ['item', 'inventory', ' Inventory ', '', 'Missing']) {
    expect(JSON.parse(String(await host.call('getLoreBooksMain', search)))).toEqual([]);
  }
});

test('getLoreBooks exposes activation and insertion fields without conflating enabled and constant', async () => {
  const host = await fixture();
  const books = JSON.parse(String(await host.call('getLoreBooksMain', 'Inventory')));
  expect(books[0]).toMatchObject({ alwaysActive: false, insertorder: 100 });
});
