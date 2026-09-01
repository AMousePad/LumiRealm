import { describe, expect, test } from 'bun:test';
import { loadVars, saveVars, VAR_STORE_KEY } from '../../src/interpreter/runtime/chat-state.js';
import type { HostApi } from '../../src/interpreter/host.js';

// Lightweight mock: only `chat.getMetadata` / `chat.setMetadata` are touched
// by loadVars/saveVars, everything else throws to surface accidental calls.
function makeMockApi(initial: Record<string, unknown> = {}): {
  api: HostApi;
  metadata: Record<string, unknown>;
  reads: number;
  writes: number;
} {
  const metadata: Record<string, unknown> = { ...initial };
  let reads = 0, writes = 0;
  const api = {
    chat: {
      async getMetadata(key: string) { reads++; return metadata[key]; },
      async setMetadata(key: string, value: unknown) { writes++; metadata[key] = value; },
      async getMessages() { throw new Error('mock: getMessages not wired'); },
      async sendMessage() { throw new Error('mock: sendMessage not wired'); },
      async editMessage() { throw new Error('mock: editMessage not wired'); },
      async deleteMessage() { throw new Error('mock: deleteMessage not wired'); },
      async inject() { throw new Error('mock: inject not wired'); },
    },
    characters: {
      get: async () => { throw new Error('mock: characters.get not wired'); },
      update: async () => { throw new Error('mock: characters.update not wired'); },
    },
  } as unknown as HostApi;
  return { api, metadata, get reads() { return reads; }, get writes() { return writes; } };
}

describe('chat-state.constants', () => {
  test('scriptstate persists under chat_variables (Lumi-native rehydrated scope)', () => {
    expect(VAR_STORE_KEY).toBe('chat_variables');
  });
});

describe('loadVars', () => {
  test('empty metadata → empty record', async () => {
    const { api } = makeMockApi();
    const out = await loadVars(api);
    expect(out).toEqual({});
  });

  test('metadata missing chat_variables → empty record', async () => {
    const { api } = makeMockApi({ other_key: 'x' });
    const out = await loadVars(api);
    expect(out).toEqual({});
  });

  test('chat_variables present → keys re-prefixed with $', async () => {
    const { api } = makeMockApi({
      chat_variables: { foo: 'bar', baz: '42' },
    });
    const out = await loadVars(api);
    expect(out).toEqual({ '$foo': 'bar', '$baz': '42' });
  });

  test('Lua state-helper __-prefixed keys round-trip with $ prefix', async () => {
    // Lua's setState(id, "phase", "A") writes chat_variables["__phase"]
    // (JSON-encoded string). Internal cache key is "$__phase".
    const { api } = makeMockApi({
      chat_variables: { __phase: '"A"', user_set: 'value' },
    });
    const out = await loadVars(api);
    expect(out).toEqual({ '$__phase': '"A"', '$user_set': 'value' });
  });

  test('non-string values coerced to string', async () => {
    const { api } = makeMockApi({
      chat_variables: { num: 42, bool: true, nil: null },
    });
    const out = await loadVars(api);
    // toStr contract: null/undefined coerce to ''.
    expect(out['$num']).toBe('42');
    expect(out['$bool']).toBe('true');
    expect(out['$nil']).toBe('');
  });

  test('throw in getMetadata → empty record (graceful)', async () => {
    const api = {
      chat: {
        async getMetadata() { throw new Error('boom'); },
      },
    } as unknown as HostApi;
    const out = await loadVars(api);
    expect(out).toEqual({});
  });

  test('non-object chat_variables → empty record', async () => {
    const { api } = makeMockApi({ chat_variables: 'not-an-object' });
    const out = await loadVars(api);
    expect(out).toEqual({});
  });
});

describe('saveVars', () => {
  test('strips $ prefix when persisting → bare keys in chat_variables', async () => {
    const mock = makeMockApi();
    await saveVars(mock.api, { '$foo': 'bar', '$baz': '42' });
    expect(mock.metadata[VAR_STORE_KEY]).toEqual({ foo: 'bar', baz: '42' });
  });

  test('keys without $ prefix kept verbatim (defensive, internal API always writes $)', async () => {
    const mock = makeMockApi();
    await saveVars(mock.api, { 'no_prefix': 'value' });
    expect(mock.metadata[VAR_STORE_KEY]).toEqual({ 'no_prefix': 'value' });
  });

  test('replaces existing chat_variables wholesale (not merge)', async () => {
    // Risu's clone-and-write in runTrigger: the runtime owns the snapshot.
    const mock = makeMockApi({
      chat_variables: { stale: 'oldval', also_stale: 'gone' },
    });
    await saveVars(mock.api, { '$fresh': 'newval' });
    expect(mock.metadata[VAR_STORE_KEY]).toEqual({ fresh: 'newval' });
  });

  test('Lua __-prefixed keys round-trip with $ stripped only', async () => {
    const mock = makeMockApi();
    await saveVars(mock.api, { '$__phase': '"A"', '$regular': 'val' });
    expect(mock.metadata[VAR_STORE_KEY]).toEqual({ __phase: '"A"', regular: 'val' });
  });

  test('throw in setMetadata → swallowed (chat-metadata write may be unauthorized)', async () => {
    const api = {
      chat: {
        async getMetadata() { return {}; },
        async setMetadata() { throw new Error('not permitted'); },
      },
    } as unknown as HostApi;
    await expect(saveVars(api, { '$foo': 'bar' })).resolves.toBeUndefined();
  });

  test('empty input still writes (clears the store)', async () => {
    const mock = makeMockApi({
      chat_variables: { stale: 'val' },
    });
    await saveVars(mock.api, {});
    expect(mock.metadata[VAR_STORE_KEY]).toEqual({});
  });
});

describe('round-trip', () => {
  test('saveVars → loadVars produces input', async () => {
    const mock = makeMockApi();
    const input = { '$a': '1', '$b': '2', '$__c': '"json"' };
    await saveVars(mock.api, input);
    const out = await loadVars(mock.api);
    expect(out).toEqual(input);
  });
});
