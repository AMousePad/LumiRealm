declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { RegexCoreScript } from '../display/regex-core.js';
import type { PrebuiltPipelineInput } from './prompt-regex-apply.js';
import type { LlmMessage } from '../adapters/spindle-extras.js';
import type { RegexRunnerReply } from '../regex-runner.js';
import type { BackendProcessHandle } from 'lumiverse-spindle-types';

const RUNNER_ENTRY = 'dist/regex-runner.js';
const RUNNER_KIND = 'lumirealm-prompt-regex';
const RUNNER_KEY = 'singleton';

const PROMPT_REGEX_TIMEOUT_MS = (() => {
  const env = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env;
  const raw = env?.LUMIREALM_PROMPT_REGEX_TIMEOUT_MS;
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();

const STARTUP_TIMEOUT_MS = 10_000;
// Above PROMPT_REGEX_TIMEOUT_MS so the per-request dispatch timeout is the binding
// kill. A catastrophic regex blocks the runner thread synchronously and stops the
// heartbeat, so an equal heartbeat budget would let the host watchdog preempt the
// dispatch timeout (it measures from the last heartbeat, ~one interval early).
const HEARTBEAT_TIMEOUT_MS = 45_000;

export interface RunnerClientDeps {
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
  readonly requestTimeoutMs?: number;
}

export interface RunnerDispatchResult {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly messages: LlmMessage[];
}

export function createPromptRegexRunnerClient(deps: RunnerClientDeps) {
  const { log, errMsg } = deps;
  const requestTimeoutMs = deps.requestTimeoutMs ?? PROMPT_REGEX_TIMEOUT_MS;

  type Pending = {
    resolve: (reply: RegexRunnerReply) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<string, Pending>();

  let handle: BackendProcessHandle | null = null;
  let handleProcessId: string | null = null;
  let spawnInFlight: Promise<BackendProcessHandle | null> | null = null;
  let listenersWired = false;
  let requestSeq = 0;

  function failAllPending(reason: string): void {
    for (const [requestId, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ requestId, ok: false, error: reason });
    }
    pending.clear();
  }

  function wireListeners(api: typeof spindle.backendProcesses): void {
    if (listenersWired) return;
    listenersWired = true;
    api.onMessage((event) => {
      if (handleProcessId !== null && event.processId !== handleProcessId) return;
      const reply = event.payload as RegexRunnerReply | undefined;
      if (!reply || typeof (reply as { requestId?: unknown }).requestId !== 'string') return;
      const p = pending.get(reply.requestId);
      if (!p) return;
      pending.delete(reply.requestId);
      clearTimeout(p.timer);
      p.resolve(reply);
    });
    api.onLifecycle((event) => {
      if (handleProcessId === null || event.processId !== handleProcessId) return;
      if (
        event.state === 'failed' ||
        event.state === 'stopped' ||
        event.state === 'timed_out' ||
        event.state === 'completed'
      ) {
        log.warn(`prompt-regex runner died state=${event.state} processId=${event.processId.slice(0, 8)}`);
        handle = null;
        handleProcessId = null;
        failAllPending(`runner ${event.state}`);
      }
    });
  }

  async function ensureHandle(userId: string | undefined): Promise<BackendProcessHandle | null> {
    if (handle !== null) return handle;
    if (spawnInFlight !== null) return spawnInFlight;
    if (userId === undefined) {
      log.warn('prompt-regex runner: no userId, cannot spawn managed process; shipping prompt without inline regex');
      return null;
    }
    const api = spindle.backendProcesses;
    wireListeners(api);
    spawnInFlight = (async () => {
      try {
        const spawned = await api.spawn({
          entry: RUNNER_ENTRY,
          kind: RUNNER_KIND,
          key: RUNNER_KEY,
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
          replaceExisting: true,
          userId,
        });
        handle = spawned;
        handleProcessId = spawned.processId;
        log.info(`prompt-regex runner spawned processId=${spawned.processId.slice(0, 8)}`);
        return spawned;
      } catch (err) {
        log.error(`prompt-regex runner spawn failed: ${errMsg(err)}`);
        handle = null;
        handleProcessId = null;
        return null;
      } finally {
        spawnInFlight = null;
      }
    })();
    return spawnInFlight;
  }

  function respawnAfterFault(): void {
    const dead = handle;
    handle = null;
    handleProcessId = null;
    if (dead) {
      void dead.stop({ reason: 'prompt-regex runner fault' }).catch(() => { /* host force-terminates */ });
    }
  }

  async function dispatch(
    prebuilt: PrebuiltPipelineInput,
    scripts: readonly RegexCoreScript[],
    messages: LlmMessage[],
    userId: string | undefined,
  ): Promise<RunnerDispatchResult> {
    const failOpen: RunnerDispatchResult = { ok: false, changed: false, messages };

    const active = await ensureHandle(userId);
    if (!active) {
      log.error('prompt-regex runner unavailable; shipping prompt without inline regex (host already skipped its pass)');
      return failOpen;
    }

    const requestId = `prq-${++requestSeq}`;
    const replyPromise = new Promise<RegexRunnerReply>((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        resolve({ requestId, ok: false, error: `timeout after ${requestTimeoutMs}ms` });
      }, requestTimeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      pending.set(requestId, { resolve, timer });
    });

    try {
      active.send({ requestId, prebuilt, scripts, messages });
    } catch (err) {
      const p = pending.get(requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(requestId);
      }
      log.error(`prompt-regex runner send failed: ${errMsg(err)}; shipping prompt without inline regex`);
      respawnAfterFault();
      return failOpen;
    }

    const reply = await replyPromise;
    if (reply.ok) {
      return { ok: true, changed: reply.changed, messages: reply.messages };
    }

    log.error(
      `prompt-regex runner request failed (${reply.error}); killing + respawning runner, shipping prompt without inline regex (host already skipped its pass)`,
    );
    respawnAfterFault();
    return failOpen;
  }

  async function warmUp(userId: string | undefined): Promise<boolean> {
    return (await ensureHandle(userId)) !== null;
  }

  return { dispatch, warmUp };
}

export type PromptRegexRunnerClient = ReturnType<typeof createPromptRegexRunnerClient>;
