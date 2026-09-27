import { afterEach, expect, spyOn, test } from 'bun:test';
import { installConsoleCapture, removeConsoleCapture } from '../../src/log/frontend-capture.js';
import { logStore } from '../../src/log/store.js';

afterEach(() => {
  removeConsoleCapture();
  logStore.setState({ enabled: false });
});

test('status polling and export do not recursively enter the diagnostic buffer', () => {
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  try {
    logStore.setState({ enabled: true, includeChatData: true, level: 'trace' });
    installConsoleCapture();
    for (let i = 0; i < 100; i++) {
      console.debug('[WS] ←', 'SPINDLE_FRONTEND_MSG', {
        identifier: 'lumirealm', data: { type: 'log_state_pushed', eventCount: i },
      });
    }
    let serialized = false;
    const exportMessage = { type: 'log_export_pushed', events: [], toJSON() { serialized = true; return {}; } };
    console.debug('[WS] ←', 'SPINDLE_FRONTEND_MSG', { identifier: 'lumirealm', data: exportMessage });
    expect(logStore.snapshot().events).toEqual([]);
    expect(serialized).toBe(false);
    console.debug('[WS] ←', 'SPINDLE_FRONTEND_MSG', { identifier: 'lumirealm', data: { type: 'display_snapshot' } });
    expect(logStore.snapshot().events).toHaveLength(1);
  } finally {
    removeConsoleCapture();
    debug.mockRestore();
  }
});
