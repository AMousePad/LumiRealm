import { describe, expect, test } from 'bun:test';
import type { SpindleAPI } from 'lumiverse-spindle-types';
import { filterBridgePermissions, parseBridgePermissionError, probeLumiagentBridge } from '../src/bridge-permissions.js';

const inherited = (permissions: string) => `Shared RPC endpoint "lumiagent.phoneline_probe" requires requester "lumirealm" to inherit owner "lumiagent" permissions: ${permissions}`;

describe('bridge permission reporting', () => {
  test.each(['memories', 'regex_scripts_unrestricted', 'mcp_servers', 'mcp_servers.create', 'future_agent_permission'])('does not request an undeclared grant: %s', (permission) => {
    expect(parseBridgePermissionError(inherited(permission))).toBeNull();
    expect(filterBridgePermissions([permission])).toEqual([]);
  });

  test('keeps declared permissions in a mixed failure and removes duplicate grants', () => {
    expect(parseBridgePermissionError(inherited('mcp_servers, characters, regex_scripts_unrestricted, chats, characters, mcp_servers.create'))).toEqual(['characters', 'chats']);
  });

  test.each(['requester', 'owner'])('recognizes explicit endpoint policy failures for the %s', (side) => {
    expect(parseBridgePermissionError(`Shared RPC endpoint "lumiagent.phoneline_request" requires ${side} "lumirealm" permissions: characters`)).toEqual(['characters']);
  });

  test('preserves permission failures wrapped by the phone-line handler', () => {
    expect(parseBridgePermissionError(`could not read pending request from lumiagent: ${inherited('characters, mcp_servers')}`)).toEqual(['characters']);
  });

  test('does not attribute another extension failure to LumiRealm', () => {
    expect(parseBridgePermissionError('Shared RPC endpoint "lumiagent.phoneline_probe" requires owner "lumiagent" permissions: characters')).toBeNull();
    expect(parseBridgePermissionError('Shared RPC endpoint "lumirealm.phoneline" requires requester "lumiagent" to inherit owner "lumirealm" permissions: images')).toBeNull();
  });

  test('does not turn absent endpoints or network errors into permission warnings', () => {
    expect(parseBridgePermissionError('Shared RPC endpoint "lumiagent.phoneline_probe" is not registered')).toBeNull();
    expect(parseBridgePermissionError('Connection closed')).toBeNull();
  });

  test.each([
    ['mcp_servers, mcp_servers.create', null],
    ['memories, regex_scripts_unrestricted', null],
    ['characters, mcp_servers', ['characters']],
  ] as const)('the permission-change probe applies the same filter: %s', async (permissions, expected) => {
    const spindle = { rpcPool: { async read(endpoint: string) {
      expect(endpoint).toBe('lumiagent.phoneline_probe');
      throw new Error(inherited(permissions));
    } } } as unknown as SpindleAPI;
    expect(await probeLumiagentBridge(spindle)).toEqual(expected);
  });

  test('a successful probe clears the missing-permission result', async () => {
    const spindle = { rpcPool: { async read() { return { ok: true }; } } } as unknown as SpindleAPI;
    expect(await probeLumiagentBridge(spindle)).toBeNull();
  });
});
