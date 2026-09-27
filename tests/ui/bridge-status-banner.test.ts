import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { setupBridgeStatusBanner, type BridgeStatusBannerHandle } from '../../src/ui/bridge-status-banner.js';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

let window: Window;
let banner: BridgeStatusBannerHandle;
let originalDocument: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  banner = setupBridgeStatusBanner({ ctx: {} as SpindleFrontendContext, log: { warn: () => {} } });
});

afterEach(() => {
  banner.destroy();
  window.happyDOM.cancelAsync();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function show(missingPermissions: string[]) {
  banner.handleBackendMessage({ type: 'notify_bridge_status', offline: true, missingPermissions, forCaller: 'lumiagent' });
}

describe('bridge banner permission filter', () => {
  test('does not show MCP or other undeclared grants from backend notifications', () => {
    show(['mcp_servers', 'mcp_servers.create', 'memories', 'regex_scripts_unrestricted']);
    expect(window.document.querySelector('.lr-bridge-banner')).toBeNull();
  });

  test('shows genuine grants from mixed notifications', () => {
    show(['mcp_servers', 'characters', 'mcp_servers.create']);
    const chips = [...window.document.querySelectorAll('.lr-bridge-perm')].map((chip) => chip.textContent);
    expect(chips).toEqual(['characters']);
    expect(window.document.body.textContent).toContain('LumiRealm is missing');
  });

  test('clears a visible warning when the next notification only has undeclared grants', () => {
    show(['characters']);
    expect(window.document.querySelector('.lr-bridge-banner')).not.toBeNull();
    show(['mcp_servers']);
    expect(window.document.querySelector('.lr-bridge-banner')).toBeNull();
  });

  test('a filtered clear resets dismissal state for future genuine failures', () => {
    show(['characters']);
    window.document.querySelector('button')!.click();
    show(['characters']);
    expect(window.document.querySelector('.lr-bridge-banner')).toBeNull();
    show(['mcp_servers']);
    show(['characters']);
    expect(window.document.querySelector('.lr-bridge-banner')).not.toBeNull();
  });
});
