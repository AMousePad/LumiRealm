import { expect, test } from 'bun:test';
import { persistLocalLore, type LocalLoreHost } from '../../src/state/local-lore.js';
import { LOCAL_LORE_KEY } from '../../src/interpreter/runtime/local-lore.js';
import type { LoreBook } from '../../src/core/schemas/lorebook.js';

const entry = (comment: string, content = comment): LoreBook => ({ comment, content, key: '', secondkey: '',
  insertorder: 100, alwaysActive: false, selective: false, mode: 'normal' });

function fixture() {
  const chats = new Map<string, Record<string, unknown>>([['original', { unrelated: { keep: true } }]]);
  let conflicts = 0;
  const host = {
    contracts: { worldInfoAdditionalEntries: 1 },
    chats: {
      get: async (id: string, userId: string) => {
        expect(userId).toBe('owner');
        return { id, metadata: structuredClone(chats.get(id)!) };
      },
      compareAndSetMetadata: async (id: string, input: { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> }, userId: string) => {
        expect(userId).toBe('owner');
        if (JSON.stringify(chats.get(id)) !== JSON.stringify(input.expected_metadata)) { conflicts++; return null; }
        chats.set(id, structuredClone(input.metadata));
        return { id, metadata: structuredClone(input.metadata) };
      },
    },
  } as unknown as LocalLoreHost;
  return { host, chats, conflicts: () => conflicts };
}

test('concurrent local upserts retry without losing distinct names or unrelated metadata', async () => {
  const f = fixture();
  await Promise.all(['a', 'b'].map(name => persistLocalLore(f.host, 'original', 'owner', entry(name))));
  expect(f.conflicts()).toBe(1);
  expect(f.chats.get('original')).toEqual({ unrelated: { keep: true }, [LOCAL_LORE_KEY]: [entry('a'), entry('b')] });
  await persistLocalLore(f.host, 'original', 'owner', entry('a', 'updated'));
  expect(f.chats.get('original')?.[LOCAL_LORE_KEY]).toEqual([entry('b'), entry('a', 'updated')]);
});

test('a fork retains its metadata snapshot when the original chat lore changes', async () => {
  const f = fixture();
  await persistLocalLore(f.host, 'original', 'owner', entry('shared', 'at branch'));
  f.chats.set('branch', structuredClone(f.chats.get('original')!));
  await persistLocalLore(f.host, 'original', 'owner', entry('shared', 'parent changed'));
  await persistLocalLore(f.host, 'branch', 'owner', entry('branch only'));
  expect(f.chats.get('branch')?.[LOCAL_LORE_KEY]).toEqual([entry('shared', 'at branch'), entry('branch only')]);
  expect(f.chats.get('original')?.[LOCAL_LORE_KEY]).toEqual([entry('shared', 'parent changed')]);
});

test('local lore requires host activation support before saving', async () => {
  const f = fixture();
  Object.assign(f.host, { contracts: {} });
  await expect(persistLocalLore(f.host, 'original', 'owner', entry('new'))).rejects.toThrow('host lacks prompt-local');
  expect(f.chats.get('original')).toEqual({ unrelated: { keep: true } });
});
