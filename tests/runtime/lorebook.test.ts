import { describe, expect, test } from 'bun:test';
import {
  makeLorebookApi,
  sortLorebookEntriesBySourceOrder,
  type LorebookCache,
} from '../../src/interpreter/runtime/lorebook.js';
import type { HostApi } from '../../src/interpreter/host.js';

interface FakeWorldInfo {
  api: HostApi;
  creates: Array<{ bookId: string; entry: unknown }>;
  updates: Array<{ id: string; patch: unknown }>;
  deletes: string[];
}

function makeFakeApi(): FakeWorldInfo {
  const creates: FakeWorldInfo['creates'] = [];
  const updates: FakeWorldInfo['updates'] = [];
  const deletes: string[] = [];
  let _idGen = 100;
  const api = {
    chat: {} as HostApi['chat'],
    characters: {} as HostApi['characters'],
    worldInfo: {
      entries: {
        async list() { return { data: [] }; },
        async create(bookId: string, entry: unknown) {
          creates.push({ bookId, entry });
          const out = { id: `wi-${++_idGen}`, ...(entry as Record<string, unknown>) };
          return out as Awaited<ReturnType<NonNullable<HostApi['worldInfo']>['entries']['create']>>;
        },
        async update(id: string, patch: unknown) {
          updates.push({ id, patch });
          return { id, ...(patch as Record<string, unknown>) } as Awaited<ReturnType<NonNullable<HostApi['worldInfo']>['entries']['update']>>;
        },
        async delete(id: string) { deletes.push(id); },
      },
    },
  } as unknown as HostApi;
  return { api, creates, updates, deletes };
}

function newCache(initial: Partial<LorebookCache> = {}): LorebookCache {
  return {
    entries: initial.entries ?? [],
    primaryBookId: initial.primaryBookId ?? null,
  };
}

const SAMPLE_ENTRIES = [
  { id: 'e1', key: ['hero', 'protagonist'], content: 'main char', comment: 'Hero', orderValue: 5 },
  { id: 'e2', key: 'villain',                 content: 'bad guy',  comment: 'Villain', orderValue: 3 },
  { id: 'e3', key: ['ally'],                   content: 'supporting', comment: 'Ally', orderValue: 1 },
];

describe('lorebook.read accessors', () => {
  test('getLorebookCount', () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookCount()).toBe(3);
  });

  test('getLorebookEntry by index', () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookEntry(0)).toBe('main char');
    expect(api.getLorebookEntry(2)).toBe('supporting');
    expect(api.getLorebookEntry(99)).toBe('null');
  });

  test('getLorebookByKey case-insensitive matches array keys', () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookByKey('HERO')).toBe('main char');
    expect(api.getLorebookByKey('protagonist')).toBe('main char');
    expect(api.getLorebookByKey('missing')).toBe('null');
  });

  test('getLorebookByKey case-insensitive matches comma-separated string keys', () => {
    const cache = newCache({
      entries: [{ id: 'e1', key: 'a, b , c', content: 'multi', comment: 'M', orderValue: 0 }],
    });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookByKey('B')).toBe('multi');
    expect(api.getLorebookByKey('c')).toBe('multi');
  });

  test('getLorebookIndexViaName / getLorebookByName', () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookIndexViaName('Villain')).toBe(1);
    expect(api.getLorebookIndexViaName('Missing')).toBe(-1);
    expect(api.getLorebookByName('Hero')).toEqual([0]);
    expect(api.getLorebookByName('vill|ally')).toEqual([1, 2]);
  });

  test('getAllLorebooks returns contents in order', () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getAllLorebooks()).toEqual(['main char', 'bad guy', 'supporting']);
  });

  test('character V2 APIs exclude entries from attached module books', () => {
    const cache = newCache({
      primaryBookId: 'character-book',
      entries: [
        { ...SAMPLE_ENTRIES[0]!, worldBookId: 'character-book' },
        { ...SAMPLE_ENTRIES[1]!, worldBookId: 'module-book' },
      ],
    });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    expect(api.getLorebookCount()).toBe(1);
    expect(api.getAllLorebooks()).toEqual(['main char']);
    expect(api.getLorebookByName('Villain')).toEqual([]);
  });

  test('source array metadata restores Risu entry order', () => {
    const ordered = sortLorebookEntriesBySourceOrder([
      { ...SAMPLE_ENTRIES[0]!, extensions: { _risu_array_index: 2 } },
      { ...SAMPLE_ENTRIES[1]!, extensions: { _risu_array_index: 0 } },
      { ...SAMPLE_ENTRIES[2]!, extensions: { _risu_array_index: 1 } },
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['e2', 'e3', 'e1']);
  });
});

describe('lorebook.modify', () => {
  test('modifyLorebook by key updates first matching entry', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.modifyLorebook('hero', 'rewritten');
    expect(fake.updates.length).toBe(1);
    expect(fake.updates[0]?.id).toBe('e1');
    expect((fake.updates[0]?.patch as { content: string }).content).toBe('rewritten');
    expect(cache.entries[0]?.content).toBe('rewritten');
  });

  test('modifyLorebook with no matching key → no-op', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.modifyLorebook('does-not-exist', 'x');
    expect(fake.updates.length).toBe(0);
  });

  test('modifyLorebookByIndex updates by position', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.modifyLorebookByIndex(1, 'New Name', 'newkey', 'new content', 99);
    expect(fake.updates.length).toBe(1);
    expect(fake.updates[0]?.id).toBe('e2');
  });

  test('modifyLorebookByIndex expands slot placeholders from the current entry', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.modifyLorebookByIndex(
      0,
      '{{slot}} updated',
      '{{slot}},new',
      '{{slot}} expanded',
      '{{slot}}0',
    );
    expect(fake.updates[0]?.patch).toEqual({
      comment: 'Hero updated',
      key: ['hero', 'protagonist', 'new'],
      content: 'main char expanded',
      orderValue: 50,
    });
  });

  test('modifyLorebookByIndex out-of-range → no-op', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.modifyLorebookByIndex(99, '', '', '', 0);
    expect(fake.updates.length).toBe(0);
  });
});

describe('lorebook.create / delete', () => {
  test('createLorebook requires primaryBookId', async () => {
    const cache = newCache({ entries: [], primaryBookId: null });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.createLorebook('Name', 'key', 'content', 0);
    expect(fake.creates.length).toBe(0);
  });

  test('createLorebook appends in Risu array order', async () => {
    const cache = newCache({
      entries: [{ id: 'e-old', key: 'old', content: 'old', comment: 'Old', orderValue: 1 }],
      primaryBookId: 'book-1',
    });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.createLorebook('New', 'newkey', 'new content', 100);
    expect(fake.creates.length).toBe(1);
    expect(cache.entries.map((entry) => entry.id)).toEqual(['e-old', 'wi-101']);
    expect(cache.entries[1]?.orderValue).toBe(100);
  });

  test('createLorebook defaults invalid insertion order to 100', async () => {
    const cache = newCache({ entries: [], primaryBookId: 'book-1' });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.createLorebook('New', 'newkey', 'new content', 'not-a-number');
    expect((fake.creates[0]?.entry as { orderValue: number }).orderValue).toBe(100);
  });

  test('deleteLorebookByIndex calls api.delete + splices cache', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.deleteLorebookByIndex(1);
    expect(fake.deletes).toEqual(['e2']);
    expect(cache.entries.length).toBe(2);
    expect(cache.entries.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  test('deleteLorebookByIndex out-of-range → no-op', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.deleteLorebookByIndex(99);
    expect(fake.deletes.length).toBe(0);
    expect(cache.entries.length).toBe(3);
  });
});

describe('lorebook.activation', () => {
  test('setLorebookActivation flips disabled flag (inverted)', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.setLorebookActivation(0, true);
    expect((fake.updates[0]?.patch as { disabled: boolean }).disabled).toBe(false);
    await api.setLorebookActivation(0, false);
    expect((fake.updates[1]?.patch as { disabled: boolean }).disabled).toBe(true);
  });

  test('setLorebookAlwaysActive sets constant flag', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES] });
    const fake = makeFakeApi();
    const api = makeLorebookApi(fake.api, cache);
    await api.setLorebookAlwaysActive(0, true);
    expect((fake.updates[0]?.patch as { constant: boolean }).constant).toBe(true);
  });
});

describe('lorebook with worldInfo unavailable', () => {
  test('mutations no-op safely when api.worldInfo missing', async () => {
    const cache = newCache({ entries: [...SAMPLE_ENTRIES], primaryBookId: 'book-1' });
    const apiNoWI = { chat: {}, characters: {} } as unknown as HostApi;
    const api = makeLorebookApi(apiNoWI, cache);
    await api.modifyLorebook('hero', 'x');
    await api.createLorebook('n', 'k', 'c', 0);
    await api.deleteLorebookByIndex(0);
    await api.setLorebookActivation(0, true);
    // Cache untouched (still 3 entries)
    expect(cache.entries.length).toBe(3);
  });
});
