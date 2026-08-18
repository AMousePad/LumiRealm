import { expect, test } from 'bun:test';
import type { SpindleBackendProcessContext } from 'lumiverse-spindle-types';

import regexRunner, { type RegexRunnerReply } from './regex-runner.js';

test('runs the managed process message and stop protocol', async () => {
  let onMessage: (payload: unknown) => void = () => {};
  let onStop: (detail: { reason?: string }) => void = () => {};
  let ready = 0;
  let completed = 0;
  const failures: string[] = [];
  let receiveReply!: (reply: RegexRunnerReply) => void;
  const reply = new Promise<RegexRunnerReply>((resolve) => { receiveReply = resolve; });
  const cleanup = regexRunner({
    heartbeat: () => {},
    onMessage: (handler) => { onMessage = handler; },
    onStop: (handler) => { onStop = handler; },
    ready: () => { ready++; },
    complete: () => { completed++; },
    fail: (message) => { failures.push(message); },
    send: (payload) => { receiveReply(payload as RegexRunnerReply); },
  } as SpindleBackendProcessContext);

  expect(ready).toBe(1);
  onMessage({ malformed: true });
  expect(failures).toEqual(['regex-runner received a malformed request payload']);

  onMessage({
    requestId: 'request',
    prebuilt: {},
    scripts: [],
    messages: [{ role: 'user', content: 'TOKEN' }],
  });
  expect(await reply).toEqual({
    requestId: 'request',
    ok: true,
    changed: false,
    messages: [{ role: 'user', content: 'TOKEN' }],
  });

  onStop({});
  expect(completed).toBe(1);
  cleanup();
});
