import { beforeEach, describe, expect, test } from 'bun:test';
import type { CharacterDTO, SpindleAPI } from 'lumiverse-spindle-types';
import { registerLumiagentPhoneline, type BridgeStatusBroadcast } from '../src/lumiagent-phoneline.js';

let failure: string | null;
let handler: Parameters<SpindleAPI['rpcPool']['handle']>[1];
let broadcasts: BridgeStatusBroadcast[];
const context = { endpoint: 'lumirealm.phoneline', requesterExtensionId: 'lumiagent', effectivePermissions: [] };
const inherited = (permissions: string) => `Shared RPC endpoint "lumiagent.phoneline_request" requires requester "lumirealm" to inherit owner "lumiagent" permissions: ${permissions}`;

beforeEach(async () => {
  failure = null;
  broadcasts = [];
  const spindle = { rpcPool: {
    handle(endpoint: string, callback: typeof handler) { handler = callback; return endpoint; },
    async read() { if (failure) throw new Error(failure); return { op: 'describe' }; },
  } } as unknown as SpindleAPI;
  registerLumiagentPhoneline(spindle, () => { throw new Error('Storage should not be used during discovery'); }, () => {}, undefined, {}, (status) => broadcasts.push(status));
  await handler(context);
  broadcasts.length = 0;
});

describe('inbound bridge permission failures', () => {
  test.each(['mcp_servers', 'mcp_servers.create', 'memories'])('rethrows undeclared permission failures without showing a grant warning: %s', async (permission) => {
    failure = inherited(permission);
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow(permission);
    expect(broadcasts).toEqual([]);
  });

  test('reports only declared grants for mixed failures', async () => {
    failure = inherited('mcp_servers, characters, mcp_servers.create');
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow('characters');
    expect(broadcasts).toEqual([{ offline: true, missingPermissions: ['characters'], forCaller: 'lumiagent' }]);
  });

  test('an undeclared-only failure clears a previous grant warning', async () => {
    failure = inherited('characters');
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow('characters');
    failure = inherited('mcp_servers, mcp_servers.create');
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow('mcp_servers');
    expect(broadcasts.at(-1)).toEqual({ offline: false, missingPermissions: [] });
  });

  test('explicit endpoint policies still report genuine missing character permission', async () => {
    failure = 'Shared RPC endpoint "lumiagent.phoneline_request" requires requester "lumirealm" permissions: characters';
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow('characters');
    expect(broadcasts.at(-1)).toEqual({ offline: true, missingPermissions: ['characters'], forCaller: 'lumiagent' });
  });

  test('successful recovery clears the warning', async () => {
    failure = inherited('characters');
    await expect(Promise.resolve().then(() => handler(context))).rejects.toThrow('characters');
    failure = null;
    await handler(context);
    expect(broadcasts.at(-1)).toEqual({ offline: false, missingPermissions: [] });
  });
});

describe('on-demand agent docs', () => {
  function docsBridge(character: CharacterDTO | null = null) {
    let request: unknown;
    let callback: typeof handler;
    let characterReads = 0;
    const spindle = {
      rpcPool: {
        handle(_endpoint: string, fn: typeof handler) { callback = fn; },
        async read() { return request; },
      },
      characters: { async get() { characterReads++; return character; } },
    } as unknown as SpindleAPI;
    registerLumiagentPhoneline(spindle, () => { throw new Error('Docs must not open module storage'); });
    return {
      call: async (value: unknown, requesterExtensionId = 'lumiagent') => {
        request = value;
        return await callback!({ ...context, requesterExtensionId }) as Record<string, any>;
      },
      characterReads: () => characterReads,
    };
  }

  test('global discovery and topic reads work without a character or module storage', async () => {
    const bridge = docsBridge();
    const manifest = await bridge.call({ op: 'describe' });
    expect(manifest.surfaces).toContainEqual(expect.objectContaining({ id: 'lumirealm_docs', scope: 'global' }));
    expect(manifest.surfaces).toContainEqual(expect.objectContaining({ id: 'module_envelope', scope: 'per_character' }));
    const base = { userId: 'user', surfaceId: 'lumirealm_docs' };
    const listed = await bridge.call({ ...base, op: 'list_items' });
    expect(listed.total).toBe(9);
    expect(new Set(listed.items.map((item: { id: string }) => item.id)).size).toBe(listed.total);
    for (const item of listed.items) {
      expect(item).not.toHaveProperty('text');
      const page = await bridge.call({ ...base, op: 'read_item', itemId: item.id });
      expect(typeof page.value).toBe('string');
      expect(page.value.length).toBeGreaterThan(100);
      expect(page.value.length).toBeLessThan(3000);
      expect(await bridge.call({ ...base, op: 'read_item', itemId: item.id, field: 'text' })).toEqual(page);
    }
    expect(bridge.characterReads()).toBe(0);
  });

  test('docs preserve caller and user gates, refuse writes and fail on unknown topics/fields', async () => {
    const bridge = docsBridge();
    const read = { op: 'read_item', userId: 'user', surfaceId: 'lumirealm_docs', itemId: 'authoring' };
    await expect(bridge.call(read, 'other')).rejects.toThrow('not authorised');
    await expect(bridge.call({ ...read, userId: '' })).rejects.toThrow('userId');
    await expect(bridge.call({ ...read, itemId: 'all' })).rejects.toThrow('Unknown LumiRealm docs topic');
    await expect(bridge.call({ ...read, field: 'private' })).rejects.toThrow('text field');
    expect(await bridge.call({ ...read, op: 'write_field', field: 'text', value: 'changed' })).toEqual({ ok: false, error: 'LumiRealm docs are read-only.' });
    expect((await bridge.call(read)).value).toContain('Read before editing');
    await expect(bridge.call({ ...read, surfaceId: 'missing' })).rejects.toThrow('unknown surface');
  });

  test('focused-card prompt contains safety and discovery without loading the manual', async () => {
    const bridge = docsBridge({ extensions: { lumirealm: { payload: { triggers: [{ comment: 'PRIVATE CARD CONTENT' }] } } } } as unknown as CharacterDTO);
    const prompt = await bridge.call({ op: 'system_prompt', userId: 'user', characterId: 'character' });
    expect(prompt.text).toContain('lumirealm_docs');
    expect(prompt.text).toContain('dedicated asset/module/state tools');
    expect(prompt.text).not.toContain('PRIVATE CARD CONTENT');
    expect(prompt.text.length).toBeLessThan(650);
    const plain = docsBridge({ extensions: {} } as CharacterDTO);
    expect(await plain.call({ op: 'system_prompt', userId: 'user', characterId: 'character' })).toEqual({ text: null });
  });
});
