import { afterEach, describe, expect, test } from 'bun:test';
import { assembleDisplaySnapshot } from '../../src/state/display-snapshot-assembly.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { buildPreloaded } from '../../src/display/host-shim.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';

const globals = globalThis as unknown as { spindle: unknown };
const originalSpindle = globals.spindle;
afterEach(() => { globals.spindle = originalSpindle; setWasmoonEnabled(true); });

function active(userId: string, moduleLorebooks?: Record<string, readonly unknown[]>): ActiveCard {
  return {
    ownerUserId: userId,
    chatId: 'chat',
    card: {
      character_id: 'character', asset_index: {}, emotion_index: {},
      risuPayload: {
        triggers: [{ type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }],
        lua_scripts: [`
          listenEdit("editDisplay", function(id, data)
            local books = getLoreBooks(id, "panel-library")
            assert(#books > 0, "panel library missing")
            local render = assert(load(books[1].content))()
            return render(data)
          end)
        `],
        at_actions: [], scriptstate_defaults: {},
        extra: moduleLorebooks ? { runtime_module_lorebooks: moduleLorebooks } : {},
      },
    },
  } as unknown as ActiveCard;
}

function host(bookIds: string[] = []) {
  const calls: unknown[][] = [];
  globals.spindle = {
    characters: { get: async (...args: unknown[]) => {
      calls.push(['character', ...args]); return { world_book_ids: bookIds };
    } },
    personas: { getActive: async () => null },
    chat: { getMessages: async () => [] },
    chats: { get: async () => ({}) },
    world_books: { entries: { list: async (...args: unknown[]) => {
      calls.push(['lore', ...args]);
      return { data: [{ id: 'host-row', comment: 'shared', content: 'host', order_value: 50 }] };
    } } },
  };
  return calls;
}

function assemble(card: ActiveCard) {
  return assembleDisplaySnapshot({
    modulesByNamespaceFromCard: () => null,
    legacyMediaFindings: () => false,
    getCompiledLibraries: () => [],
  }, card, 'chat', card.ownerUserId, { local: {}, global: {}, chat: {} });
}

describe('display snapshot module lore', () => {
  test('loads a synthetic module library in the frontend editDisplay hook', async () => {
    host();
    const snap = await assemble(active('owner-a', {
      module: [{ comment: 'panel-library', content: 'return function(data) return data .. "<controls>" end' }],
    }));
    setWasmoonEnabled(false);
    expect(await runEditDisplayChain(
      snap, 'panel', { chatId: 'chat', isUser: false, depth: 0 },
      async value => value, () => {},
    )).toBe('panel<controls>');
  });

  test('preserves host rows, module order and distinct rows with matching names or IDs', async () => {
    const calls = host(['host-book']);
    const snap = await assemble(active('owner-a', {
      first: [null, { id: 'host-row', comment: 'shared', content: 'module-a', insertorder: 20 }],
      second: [{ comment: 'shared', content: 'module-b', key: ['x'], disabled: true, constant: true }],
    }));
    expect(snap.lorebookHost.map(row => row.content)).toEqual(['host', 'module-a', 'module-b']);
    expect(snap.lorebookHost[1]?.orderValue).toBe(20);
    expect(snap.lorebookHost[2]).toMatchObject({ id: 'module-lore-2', key: ['x'], disabled: true, constant: true, orderValue: 100 });
    expect(buildPreloaded(snap).lorebook?.entries).toEqual([...snap.lorebookHost]);
    expect(buildPreloaded(snap).lorebook?.primaryBookId).toBe('host-book');
    expect(calls).toEqual([
      ['character', 'character', 'owner-a'],
      ['lore', 'host-book', { limit: 1000, userId: 'owner-a' }],
    ]);
  });

  test('does not retain another active card module lore or fetch unattached modules', async () => {
    const calls = host();
    const first = await assemble(active('owner-a', { module: [{ content: 'owner-a only' }] }));
    const second = await assemble(active('owner-b'));
    expect(first.lorebookHost.map(row => row.content)).toEqual(['owner-a only']);
    expect(second.lorebookHost).toEqual([]);
    expect(calls).toEqual([
      ['character', 'character', 'owner-a'], ['character', 'character', 'owner-b'],
    ]);
  });
});
