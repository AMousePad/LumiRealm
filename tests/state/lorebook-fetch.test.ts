import { afterEach, expect, test } from 'bun:test';
import { fetchLorebookForCharacter } from '../../src/state/lorebook-fetch';
import { createActiveCardLoader, type ActiveCardLoaderDeps } from '../../src/state/active-card';
import { getActiveLorebook, getActiveLorebookByCharacter, hasActiveLorebookForCharacter, resetAllActiveLorebook, setActiveLorebook } from '../../src/state/lorebook-cache';
import type { ActiveCard } from '../../src/interpreter/dispatch';

const globals = globalThis as unknown as { spindle?: unknown };
const original = globals.spindle;
afterEach(() => { globals.spindle = original; resetAllActiveLorebook(); });

const modules = [
  { worldBookId: 'global', comment: 'Global', key: 'one, two', secondkey: 'secondary', content: 'global content', insertorder: 17, alwaysActive: true, selective: true },
  { worldBookId: 'attached', comment: 'Attached', key: 'stale', content: 'stale attached' },
];
function host() {
  globals.spindle = { world_books: { entries: { list: async (bookId: string, opts: { userId: string }) => {
    expect(opts.userId).toBe('owner');
    return { data: [{ id: `${bookId}-row`, world_book_id: bookId, key: [bookId], content: `live ${bookId}`, comment: bookId,
      order_value: 12, extensions: { internal: { nested: true } } }] };
  } } } };
}

test('lorebook fetch combines character and live attached rows with global module lore', async () => {
  host();
  const source = await fetchLorebookForCharacter(['character', 'attached'], 'owner', modules);
  const rows = [...source.character, ...source.modules];
  expect(rows.map(row => row.content)).toEqual(['live character', 'global content', 'live attached']);
  expect(rows[1]).toMatchObject({ key: 'one, two', secondkey: 'secondary', content: 'global content', insertorder: 17, alwaysActive: true, selective: true });
  expect(rows.every(row => Object.values(row).every(value => value === null || typeof value !== 'object'))).toBe(true);
});

test('warm active-card cache repopulates CBS lore with module rows', async () => {
  host();
  const active = { ownerUserId: 'owner', card: { character_id: 'character', risuPayload: {
    extra: { runtime_module_lorebooks: { global: [modules[0]] } },
  } } } as unknown as ActiveCard;
  const loader = createActiveCardLoader({
    activeCardByChat: new Map([['chat', active]]), worldBookIdsByCharacter: new Map([['character', []]]),
    hasActiveLorebookForCharacter, getActiveLorebookByCharacter, setActiveLorebook, fetchLorebookForCharacter,
    log: { info() {}, debug() {}, warn() {}, error() {} }, errMsg: String,
  } as unknown as ActiveCardLoaderDeps);
  expect(await loader.ensureActiveCardForChat('chat', 'character', 'owner')).toBe(active);
  expect(getActiveLorebook('chat').map(row => row.content)).toEqual(['global content']);
});
