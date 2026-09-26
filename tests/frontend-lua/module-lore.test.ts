import { expect, test } from 'bun:test';
import { createFrontendHost } from '../../src/frontend-lua/host';
import { FrontendRuntimeState } from '../../src/frontend-lua/state';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store';
import type { DisplaySnapshot } from '../../src/display/snapshot';

test('browser runtime combines live attached lore and global module lore without duplicates', () => {
  const state = new FrontendRuntimeState({
    revision: { epoch: 'test', sequence: 1 }, chat: { id: 'chat', metadata: {} },
    character: { id: 'character', world_book_ids: ['attached', 'emptied'] }, persona: null, messages: [],
    lore: [{ id: 'live', world_book_id: 'attached', content: 'live attached' }], globalVariables: {},
  }, async () => { throw new Error('Unexpected write'); }, () => {});
  const snapshot = {
    scriptstateDefaults: {}, lorebookHost: [
      { id: 'live', worldBookId: 'attached', content: 'stale attached' },
      { id: 'deleted', worldBookId: 'emptied', content: 'stale deleted' },
      { id: 'global', worldBookId: 'global-book', content: 'global module', alwaysActive: true },
    ],
  } as unknown as DisplaySnapshot;
  const runtime = createFrontendHost(state, () => snapshot, DEFAULT_SETTINGS, {
    call: async () => { throw new Error('Unexpected service'); }, ui: {},
    expression: async () => {}, invalidate() {}, synchronize: async () => {},
  });
  expect(runtime.prepareRuntime().preloaded!.lorebook!.entries.map(entry => [entry.content, entry.constant]))
    .toEqual([['live attached', undefined], ['global module', true]]);
});
