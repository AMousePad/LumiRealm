import type { SpindleAPI } from 'lumiverse-spindle-types';
import manifest from '../spindle.json';

const declaredPermissions = new Set<string>(manifest.permissions);

export function filterBridgePermissions(permissions: readonly string[]): string[] {
  return [...new Set(permissions.map((permission) => permission.trim()))]
    .filter((permission) => declaredPermissions.has(permission))
    .sort();
}

export function parseBridgePermissionError(message: string): readonly string[] | null {
  const match = /Shared RPC endpoint "[^"]+" requires (?:requester|owner) "([^"]+)"(?: to inherit owner "[^"]+")? permissions: ([^]+?)$/.exec(message);
  if (!match || match[1] !== manifest.identifier) return null;
  // The banner can only request grants that this extension actually declares.
  const permissions = filterBridgePermissions(match[2]!.split(/,\s*/));
  return permissions.length > 0 ? permissions : null;
}

export async function probeLumiagentBridge(spindle: SpindleAPI): Promise<readonly string[] | null> {
  try {
    await spindle.rpcPool.read('lumiagent.phoneline_probe');
    return null;
  } catch (err) {
    return parseBridgePermissionError(err instanceof Error ? err.message : String(err));
  }
}
