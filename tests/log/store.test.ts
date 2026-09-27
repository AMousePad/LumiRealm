import { afterEach, expect, test } from 'bun:test';
import { logStore } from '../../src/log/store.js';

afterEach(() => {
  logStore.setState({ enabled: false });
  logStore.setState({ enabled: false }, 'capture-user');
  logStore.clear();
});

test.each([undefined, 'capture-user'])('capture retains early events past five megabytes for %s', userId => {
  logStore.clear();
  logStore.setState({ enabled: true, includeChatData: true, level: 'trace' }, userId);
  logStore.push('info', 'generation', 'started', userId);
  const payload = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 6; i++) logStore.push('trace', 'snapshot', `${i}:${payload}`, userId);
  logStore.push('info', 'generation', 'finished', userId);

  const events = logStore.snapshot(userId).events;
  expect(events).toHaveLength(8);
  expect(events[0]?.message).toBe('started');
  expect(events.slice(1, -1).map(event => event.message.slice(0, 2))).toEqual(['0:', '1:', '2:', '3:', '4:', '5:']);
  expect(events.at(-1)?.message).toBe('finished');
  expect(logStore.getState(userId).bufferBytes).toBeGreaterThan(6 * 1024 * 1024);
  logStore.setState({ enabled: false }, userId);
  expect(logStore.snapshot(userId).events).toHaveLength(0);
  expect(logStore.getState(userId).bufferBytes).toBe(0);
});
