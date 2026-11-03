import { expect, test } from 'bun:test';
import { createLocalLoreFrame, characterLocalLore, publishLocalLoreFrame, upsertFrameLocalLore, upsertLocalLore, type LocalLoreAccess } from '../../src/interpreter/runtime/local-lore.js';
import { cloneInvocation, initializeInvocation, type TriggerInvocationState } from '../../src/interpreter/runtime/invocation.js';
import { loreBookSchema, type LoreBook } from '../../src/core/schemas/lorebook.js';
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

const lore = (comment: string, content: string): LoreBook => loreBookSchema.parse({ comment, content });

function fixture(entries: readonly LoreBook[]) {
  let current = entries, writes = 0;
  const access: LocalLoreAccess = {
    get: () => current,
    async upsert(entry) { writes++; current = upsertLocalLore(current, entry); },
    async replace(value) { writes++; current = value; },
  };
  const state: TriggerInvocationState = { localLore: createLocalLoreFrame(access), localLoreAccess: access,
    varsCache: {}, messagesCache: [], stopSending: false };
  initializeInvocation(state, makeLuaDivergenceHost().api);
  return { access, state, writes: () => writes, external(value: readonly LoreBook[]) { current = value; } };
}

test('unmodified nested lore frames do not traverse entry contents or persist copies', async () => {
  let reads = 0;
  const entries = Object.freeze(Array.from({ length: 256 }, (_, index) => Object.freeze({ ...lore(String(index), 'Saved lore'),
    get content() { reads++; return 'Saved lore'; } })));
  const f = fixture(entries);
  const child = cloneInvocation(f.state);
  await publishLocalLoreFrame(child.localLore!, 'character');
  await publishLocalLoreFrame(f.state.localLore!, 'chat');
  expect(reads).toBe(0);
  expect(f.writes()).toBe(0);
});

test('immutable parent and child snapshots survive later external replacement and independent adoption', async () => {
  const original = Object.freeze([Object.freeze(lore('Original', 'original'))]);
  const f = fixture(original), parent = f.state.localLore!, child = cloneInvocation(f.state).localLore!;
  f.external([lore('External', 'external')]);
  upsertFrameLocalLore(parent, lore('Parent', 'parent'));
  expect(characterLocalLore(child).map(entry => entry.comment)).toEqual(['Original']);
  await publishLocalLoreFrame(child, 'character');
  await upsertFrameLocalLore(child, lore('Child', 'child'));
  expect(f.access.get().map(entry => entry.comment)).toEqual(['Original', 'Child']);
  await publishLocalLoreFrame(parent, 'character');
  expect(f.access.get().map(entry => entry.comment)).toEqual(['Original', 'Parent']);
  expect(characterLocalLore(child).map(entry => entry.comment)).toEqual(['Original', 'Child']);
  await publishLocalLoreFrame(parent, 'chat');
  expect(f.access.get()).toEqual(original);
});
