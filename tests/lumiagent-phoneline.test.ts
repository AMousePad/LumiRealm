import { beforeEach, describe, expect, test } from 'bun:test';
import type { SpindleAPI } from 'lumiverse-spindle-types';
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
  test.each(['mcp_servers', 'mcp_servers.create', 'memories', 'regex_scripts_unrestricted'])('rethrows undeclared permission failures without showing a grant warning: %s', async (permission) => {
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
