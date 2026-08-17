import { afterEach, describe, expect, test } from 'bun:test';

import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';

type Connection = {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_default: boolean;
  has_api_key: boolean;
};

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'Primary',
    provider: 'openai',
    model: 'connection-model',
    is_default: false,
    has_api_key: true,
    ...overrides,
  };
}

function harness(options: {
  explicit?: Connection | null;
  list?: readonly Connection[];
  getError?: Error;
  listError?: Error;
  rawError?: Error;
  rawResult?: unknown;
} = {}) {
  const calls = {
    get: [] as unknown[][],
    list: [] as unknown[][],
    raw: [] as unknown[][],
  };
  (globalThis as { spindle?: unknown }).spindle = {
    connections: {
      async get(...args: unknown[]) {
        calls.get.push(args);
        if (options.getError) throw options.getError;
        return options.explicit === undefined ? connection() : options.explicit;
      },
      async list(...args: unknown[]) {
        calls.list.push(args);
        if (options.listError) throw options.listError;
        return options.list ?? [connection({ is_default: true })];
      },
    },
    generate: {
      async raw(...args: unknown[]) {
        calls.raw.push(args);
        if (options.rawError) throw options.rawError;
        return options.rawResult === undefined ? { content: 'generated' } : options.rawResult;
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

describe('spindle host generation and connections', () => {
  test('always exposes the current APIs and maps connection summaries', async () => {
    const listed = connection({
      id: 'conn-listed', name: 'Listed', provider: 'anthropic', model: 'claude', is_default: true,
    });
    const { host, calls } = harness({ list: [listed] });

    expect(host.llm).toBeDefined();
    expect(host.llm!.listConnections).toBeDefined();
    expect(await host.llm!.listConnections!()).toEqual([{
      id: 'conn-listed', name: 'Listed', provider: 'anthropic', model: 'claude', is_default: true,
    }]);
    expect(calls.list).toEqual([['user-1']]);
  });

  test('maps explicit connection, request, roles, samplers, prefill, and user scope', async () => {
    const explicit = connection({ id: 'conn-explicit', provider: 'openai', model: 'connection-model' });
    const { host, calls } = harness({ explicit, rawResult: { content: 'done' } });

    const result = await host.llm!.generate({
      connectionId: 'conn-explicit',
      provider: 'anthropic',
      model: 'request-model',
      parameters: { temperature: 0.4, top_p: 0.9, frequency_penalty: 1, min_p: 0.2 },
      prefillCompat: true,
      messages: [
        { role: 'sys', content: 'system' },
        { role: 'bot', content: 'bot' },
        { role: 'char', content: 'char' },
        { role: 'other', content: 'other' },
        { role: 'user', content: 'prompt' },
        { role: 'assistant', content: 'prefix' },
      ],
    });

    expect(result).toEqual({ content: 'done' });
    expect(calls.get).toEqual([['conn-explicit', 'user-1']]);
    expect(calls.list).toEqual([]);
    expect(calls.raw).toEqual([[{
      type: 'raw',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'bot' },
        { role: 'assistant', content: 'char' },
        { role: 'user', content: 'other' },
        { role: 'user', content: 'prompt\n\nBegin your response with:\nprefix' },
      ],
      connection_id: 'conn-explicit',
      provider: 'anthropic',
      model: 'request-model',
      parameters: { temperature: 0.4, top_p: 0.9, model: 'request-model' },
      userId: 'user-1',
    }]]);
  });

  test('uses the default connection and its provider and model', async () => {
    const first = connection({ id: 'conn-first', provider: 'openai', model: 'first-model' });
    const selected = connection({
      id: 'conn-default', provider: 'google', model: 'default-model', is_default: true,
    });
    const { host, calls } = harness({ list: [first, selected] });

    await host.llm!.generate({ messages: [{ role: 'user', content: 'prompt' }] });

    expect(calls.get).toEqual([]);
    expect(calls.list).toEqual([['user-1']]);
    expect(calls.raw[0]?.[0]).toMatchObject({
      connection_id: 'conn-default', provider: 'google', model: 'default-model', userId: 'user-1',
    });
  });

  test('uses the first connection when none is default and propagates generation failures', async () => {
    const rawError = new Error('provider failed');
    const { host, calls } = harness({
      list: [connection({ id: 'conn-first' }), connection({ id: 'conn-second' })],
      rawError,
    });

    await expect(host.llm!.generate({ messages: [] })).rejects.toThrow(rawError.message);
    expect(calls.raw[0]?.[0]).toMatchObject({ connection_id: 'conn-first' });
  });

  test('reports a missing explicit connection unchanged', async () => {
    const { host } = harness({ explicit: null });
    await expect(host.llm!.generate({ connectionId: 'missing-profile', messages: [] })).rejects.toThrow(
      'Connection profile "missing-…" not found. Pick a different one in Risu Settings → Auxiliary Model.',
    );
  });

  test('reports an empty connection list unchanged', async () => {
    const { host } = harness({ list: [] });
    await expect(host.llm!.generate({ messages: [] })).rejects.toThrow(
      'No connection profiles configured. Set up a connection in Lumiverse Settings → Connections, then pick it (or mark it default).',
    );
  });

  test('wraps connection lookup failures unchanged', async () => {
    const { host: explicitHost } = harness({ getError: new Error('get denied') });
    await expect(explicitHost.llm!.generate({ connectionId: 'conn-1', messages: [] })).rejects.toThrow(
      'Connection resolution failed: get denied',
    );

    const { host: defaultHost } = harness({ listError: new Error('list denied') });
    await expect(defaultHost.llm!.generate({ messages: [] })).rejects.toThrow(
      'Connection resolution failed: list denied',
    );
  });

  test('returns empty content for a raw response without text', async () => {
    const { host } = harness({ rawResult: { content: 3 } });
    expect(await host.llm!.generate({ messages: [] })).toEqual({ content: '' });
  });
});
