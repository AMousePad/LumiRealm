import { afterEach, describe, expect, test } from 'bun:test';

import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';

function worldEntry(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    world_book_id: 'book-1',
    key: ['alpha'],
    content: 'content',
    comment: 'comment',
    order_value: 42,
    disabled: false,
    constant: true,
    extensions: { source: 'risu' },
    ...overrides,
  };
}

function persona(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'persona-1',
    name: 'Persona',
    title: '',
    description: 'Description',
    image_id: 'image-1',
    attached_world_book_id: null,
    folder: '',
    is_default: true,
    metadata: {},
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function harness(options: {
  activePersona?: Record<string, unknown> | null;
  worldError?: Error;
  personaError?: Error;
} = {}) {
  const calls = {
    list: [] as unknown[][],
    create: [] as unknown[][],
    update: [] as unknown[][],
    delete: [] as unknown[][],
    getActive: [] as unknown[][],
    updatePersona: [] as unknown[][],
  };
  const activePersona = options.activePersona === undefined ? persona() : options.activePersona;
  (globalThis as { spindle?: unknown }).spindle = {
    world_books: {
      entries: {
        async list(...args: unknown[]) {
          calls.list.push(args);
          if (options.worldError) throw options.worldError;
          return { data: [worldEntry('entry-list')], total: 1 };
        },
        async create(...args: unknown[]) {
          calls.create.push(args);
          if (options.worldError) throw options.worldError;
          return worldEntry('entry-created', args[1] as Record<string, unknown>);
        },
        async update(...args: unknown[]) {
          calls.update.push(args);
          if (options.worldError) throw options.worldError;
          return worldEntry(String(args[0]), args[1] as Record<string, unknown>);
        },
        async delete(...args: unknown[]) {
          calls.delete.push(args);
          if (options.worldError) throw options.worldError;
          return true;
        },
      },
    },
    personas: {
      async getActive(...args: unknown[]) {
        calls.getActive.push(args);
        if (options.personaError) throw options.personaError;
        return activePersona;
      },
      async update(...args: unknown[]) {
        calls.updatePersona.push(args);
        if (options.personaError) throw options.personaError;
        return persona(args[1] as Record<string, unknown>);
      },
    },
  };
  return {
    calls,
    host: makeSpindleHost({ chatId: 'chat-1', characterId: 'char-1', userId: 'user-1' }),
  };
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('spindle host world books', () => {
  test('lists entries with user scope and maps DTO aliases', async () => {
    const { host, calls } = harness();
    const result = await host.worldInfo!.entries.list('book-1', { limit: 25 });

    expect(calls.list).toEqual([['book-1', { limit: 25, userId: 'user-1' }]]);
    expect(result.data[0]).toMatchObject({
      id: 'entry-list',
      worldBookId: 'book-1',
      key: ['alpha'],
      content: 'content',
      comment: 'comment',
      orderValue: 42,
      disabled: false,
      constant: true,
      extensions: { source: 'risu' },
    });
  });

  test('creates entries with mapped fields and user scope', async () => {
    const { host, calls } = harness();
    const result = await host.worldInfo!.entries.create('book-1', {
      key: 'alpha', content: 'new', comment: 'name', orderValue: 7, disabled: true, constant: false,
    });

    expect(calls.create).toEqual([[
      'book-1',
      { key: ['alpha'], content: 'new', comment: 'name', order_value: 7, disabled: true, constant: false },
      'user-1',
    ]]);
    expect(result).toMatchObject({ id: 'entry-created', worldBookId: 'book-1', orderValue: 7 });
  });

  test('updates and deletes entries with user scope', async () => {
    const { host, calls } = harness();
    const updated = await host.worldInfo!.entries.update('entry-1', {
      key: ['beta'], content: 'updated', orderValue: 9,
    });
    const deleted = await host.worldInfo!.entries.delete('entry-1');

    expect(calls.update).toEqual([[
      'entry-1', { key: ['beta'], content: 'updated', order_value: 9 }, 'user-1',
    ]]);
    expect(calls.delete).toEqual([['entry-1', 'user-1']]);
    expect(updated).toMatchObject({ id: 'entry-1', key: ['beta'], content: 'updated', orderValue: 9 });
    expect(deleted).toBeUndefined();
  });
});

describe('spindle host personas', () => {
  test('maps the active persona and scopes reads and updates', async () => {
    const { host, calls } = harness();
    const active = await host.personas!.getActive();
    await host.personas!.update('persona-1', { description: 'Updated' });

    expect(calls.getActive).toEqual([['user-1']]);
    expect(calls.updatePersona).toEqual([['persona-1', { description: 'Updated' }, 'user-1']]);
    expect(active).toMatchObject({
      id: 'persona-1', description: 'Description', imageId: 'image-1', image_id: 'image-1',
    });
  });

  test('returns null when there is no active persona', async () => {
    const { host } = harness({ activePersona: null });
    expect(await host.personas!.getActive()).toBeNull();
  });
});

test('current API permission failures propagate', async () => {
  const worldError = new Error('world_books permission denied');
  const personaError = new Error('personas permission denied');
  const { host } = harness({ worldError, personaError });

  await expect(host.worldInfo!.entries.list('book-1')).rejects.toThrow(worldError.message);
  await expect(host.personas!.getActive()).rejects.toThrow(personaError.message);
});
