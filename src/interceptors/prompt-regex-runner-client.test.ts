import { afterEach, describe, expect, test } from 'bun:test';
import type {
  BackendProcessHandle,
  BackendProcessLifecycleEventDTO,
  BackendProcessSpawnOptionsDTO,
} from 'lumiverse-spindle-types';

import type { LlmMessage } from '../adapters/spindle-extras.js';
import type { RegexRunnerReply } from '../regex-runner.js';
import { createPromptRegexRunnerClient } from './prompt-regex-runner-client.js';

type MessageEvent = { processId: string; payload: unknown; userId: string };

function installHost() {
  const spawnCalls: BackendProcessSpawnOptionsDTO[] = [];
  const sent: { processId: string; payload: unknown }[] = [];
  const stopped: { processId: string; reason?: string }[] = [];
  let messageHandler: (event: MessageEvent) => void = () => {};
  let lifecycleHandler: (event: BackendProcessLifecycleEventDTO) => void = () => {};
  let processSequence = 0;
  const state: {
    spawn: (options: BackendProcessSpawnOptionsDTO) => Promise<BackendProcessHandle>;
  } = {
    spawn: async () => makeHandle(),
  };

  function makeHandle(processId = `process-${++processSequence}`): BackendProcessHandle {
    return {
      processId,
      send: (payload) => { sent.push({ processId, payload }); },
      stop: async (options) => {
        stopped.push({
          processId,
          ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        });
      },
    } as BackendProcessHandle;
  }

  (globalThis as { spindle?: unknown }).spindle = {
    backendProcesses: {
      spawn: async (options: BackendProcessSpawnOptionsDTO) => {
        spawnCalls.push(options);
        return state.spawn(options);
      },
      onMessage: (handler: (event: MessageEvent) => void) => {
        messageHandler = handler;
        return () => {};
      },
      onLifecycle: (handler: (event: BackendProcessLifecycleEventDTO) => void) => {
        lifecycleHandler = handler;
        return () => {};
      },
    },
  };

  return {
    spawnCalls,
    sent,
    stopped,
    state,
    makeHandle,
    emitMessage: (event: MessageEvent) => { messageHandler(event); },
    emitLifecycle: (event: Partial<BackendProcessLifecycleEventDTO> & { processId: string; state: BackendProcessLifecycleEventDTO['state'] }) => {
      lifecycleHandler(event as BackendProcessLifecycleEventDTO);
    },
  };
}

function client(requestTimeoutMs = 1_000) {
  return createPromptRegexRunnerClient({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: String,
    requestTimeoutMs,
  });
}

const messages: LlmMessage[] = [{ role: 'user', content: 'TOKEN' }];

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('prompt regex runner client', () => {
  test('coalesces startup and keeps the current spawn contract', async () => {
    const host = installHost();
    let release!: (handle: BackendProcessHandle) => void;
    host.state.spawn = () => new Promise((resolve) => { release = resolve; });
    const runner = client();

    const first = runner.warmUp('user');
    const second = runner.warmUp('user');
    await Promise.resolve();
    expect(host.spawnCalls).toHaveLength(1);
    release(host.makeHandle('process-one'));

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(host.spawnCalls[0]).toEqual({
      entry: 'dist/regex-runner.js',
      kind: 'lumirealm-prompt-regex',
      key: 'singleton',
      startupTimeoutMs: 10_000,
      heartbeatTimeoutMs: 45_000,
      replaceExisting: true,
      userId: 'user',
    });
  });

  test('keeps startup rejection nonfatal', async () => {
    const host = installHost();
    host.state.spawn = async () => { throw new Error('spawn failed'); };

    expect(await client().warmUp('user')).toBe(false);
    expect(host.spawnCalls).toHaveLength(1);
  });

  test('correlates replies by process and request', async () => {
    const host = installHost();
    const runner = client();
    const resultPromise = runner.dispatch({} as never, [], messages, 'user');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = host.sent[0]!.payload as { requestId: string };
    let settled = false;
    void resultPromise.then(() => { settled = true; });

    host.emitMessage({
      processId: 'foreign',
      userId: 'user',
      payload: { requestId: request.requestId, ok: true, changed: true, messages: [] },
    });
    host.emitMessage({
      processId: 'process-1',
      userId: 'user',
      payload: { requestId: 'unknown', ok: true, changed: true, messages: [] },
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const transformed: LlmMessage[] = [{ role: 'user', content: 'TOKEN!' }];
    const reply: RegexRunnerReply = {
      requestId: request.requestId,
      ok: true,
      changed: true,
      messages: transformed,
    };
    host.emitMessage({ processId: 'process-1', userId: 'user', payload: reply });

    expect(await resultPromise).toEqual({ ok: true, changed: true, messages: transformed });
    expect(host.stopped).toEqual([]);
  });

  test('fails open on timeout, stops once, and respawns', async () => {
    const host = installHost();
    const runner = client(5);
    const keepAlive = setTimeout(() => {}, 50);
    const result = await runner.dispatch({} as never, [], messages, 'user');
    clearTimeout(keepAlive);

    expect(result).toEqual({ ok: false, changed: false, messages });
    expect(result.messages).toBe(messages);
    expect(host.stopped).toEqual([{
      processId: 'process-1',
      reason: 'prompt-regex runner fault',
    }]);
    expect(await runner.warmUp('user')).toBe(true);
    expect(host.spawnCalls).toHaveLength(2);
  });

  test('fails pending requests open when the process dies', async () => {
    const host = installHost();
    const runner = client();
    const firstMessages: LlmMessage[] = [{ role: 'user', content: 'first' }];
    const secondMessages: LlmMessage[] = [{ role: 'user', content: 'second' }];
    const first = runner.dispatch({} as never, [], firstMessages, 'user');
    const second = runner.dispatch({} as never, [], secondMessages, 'user');
    await new Promise((resolve) => setTimeout(resolve, 0));

    host.emitLifecycle({ processId: 'foreign', state: 'stopped' });
    host.emitLifecycle({ processId: 'process-1', state: 'stopped' });

    expect(await first).toEqual({ ok: false, changed: false, messages: firstMessages });
    expect(await second).toEqual({ ok: false, changed: false, messages: secondMessages });
    expect(host.stopped).toEqual([]);
    expect(await runner.warmUp('user')).toBe(true);
    expect(host.spawnCalls).toHaveLength(2);
  });
});
