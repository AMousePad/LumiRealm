import { afterEach, expect, spyOn, test } from 'bun:test';
import { makeFrontendLogger } from '../../src/log/frontend-log.js';
import { installConsoleCapture, removeConsoleCapture } from '../../src/log/frontend-capture.js';
import { logStore } from '../../src/log/store.js';

afterEach(() => {
  removeConsoleCapture();
  logStore.setState({ enabled: false });
  logStore.clear();
});

test('disabled and filtered frontend logs do not serialize payloads', () => {
  let serialized = 0;
  const value = { toJSON() { serialized++; return { detail: 'payload' }; } };
  const logger = makeFrontendLogger('test');
  logStore.setState({ enabled: false });
  logger.trace('snapshot', value);
  logStore.setState({ enabled: true, level: 'warn' });
  logger.info('snapshot', value);
  expect(serialized).toBe(0);
  expect(logStore.snapshot().events).toHaveLength(0);
});

test('disabled error logs still reach the console without formatting for storage', () => {
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let serialized = false;
    const value = { toJSON() { serialized = true; return {}; } };
    logStore.setState({ enabled: false });
    makeFrontendLogger('test').error('failed', value);
    expect(error).toHaveBeenCalledWith('[lumirealm]', 'test:', 'failed', value);
    expect(serialized).toBe(false);
    expect(logStore.snapshot().events).toHaveLength(0);
  } finally { error.mockRestore(); }
});

test('console capture avoids duplicate formatting of extension logs', () => {
  const output = spyOn(console, 'log').mockImplementation(() => {});
  try {
    let serialized = 0;
    const value = { toJSON() { serialized++; return { detail: 'payload' }; } };
    logStore.setState({ enabled: true, includeChatData: true, level: 'trace' });
    installConsoleCapture();
    makeFrontendLogger('test').trace('snapshot', value);
    expect(serialized).toBe(1);
    expect(output).toHaveBeenCalledTimes(1);
    expect(logStore.snapshot().events.map(e => e.message)).toEqual(['snapshot {"detail":"payload"}']);
  } finally { removeConsoleCapture(); output.mockRestore(); }
});

test('filtered console events preserve console output and skip serialization', () => {
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  try {
    let serialized = false;
    const value = { toJSON() { serialized = true; return {}; } };
    logStore.setState({ enabled: true, level: 'warn' });
    installConsoleCapture();
    console.debug('host event', value);
    expect(debug).toHaveBeenCalledWith('host event', value);
    expect(serialized).toBe(false);
    expect(logStore.snapshot().events).toHaveLength(0);
  } finally { removeConsoleCapture(); debug.mockRestore(); }
});

test('recorded console payloads keep formatting and redaction', () => {
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  try {
    logStore.setState({ enabled: true, includeChatData: false, level: 'trace' });
    installConsoleCapture();
    console.debug('host event', { token: 'Bearer sample-secret' });
    const messages = logStore.snapshot().events.map(e => e.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[REDACTED]');
    expect(messages[0]).not.toContain('sample-secret');
    console.debug('[lumirealmish]', { value: 1 });
    expect(logStore.snapshot().events).toHaveLength(2);
  } finally { removeConsoleCapture(); debug.mockRestore(); }
});
