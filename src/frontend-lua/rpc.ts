import { v4 } from 'uuid';
import { FrontendLuaExecutionError, FrontendLuaUnavailableError, type FrontendLuaCall, type FrontendLuaReply } from './protocol.js';

type CallInput = Omit<FrontendLuaCall, 'type' | 'requestId'>;
type Pending = { userId: string; sessionId: string; resolve(value: unknown): void; reject(error: Error): void; cleanup(): void };

export function createFrontendLuaRpc(send: (message: FrontendLuaCall | { type: 'lua_cancel'; sessionId: string; requestId: string }, userId: string) => void) {
  const pending = new Map<string, Pending>();
  function cancel(requestId: string, error: Error): void {
    const call = pending.get(requestId);
    if (!call) return;
    pending.delete(requestId);
    call.cleanup();
    call.reject(error);
    // The rejected call must stay settled even when its transport has already closed.
    try { send({ type: 'lua_cancel', sessionId: call.sessionId, requestId }, call.userId); }
    catch { /* The caller already receives the cancellation error. */ }
  }
  return {
    call(userId: string, input: CallInput, options: { signal?: AbortSignal; timeoutMs: number }): Promise<unknown> {
      if (!userId || !input.sessionId) return Promise.reject(new FrontendLuaUnavailableError('Lua requires the browser session that owns this operation'));
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) return Promise.reject(new RangeError('Lua operation requires a positive finite deadline'));
      if (options.signal?.aborted) return Promise.reject(new FrontendLuaUnavailableError('Lua operation was cancelled'));
      const requestId = v4();
      return new Promise((resolve, reject) => {
        const aborted = () => cancel(requestId, new FrontendLuaUnavailableError('Lua operation was cancelled'));
        const timer = setTimeout(() => cancel(requestId, new FrontendLuaUnavailableError('The browser Lua operation did not complete before its deadline')), options.timeoutMs);
        options.signal?.addEventListener('abort', aborted, { once: true });
        pending.set(requestId, { userId, sessionId: input.sessionId, resolve, reject, cleanup() {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', aborted);
        } });
        try { send({ type: 'lua_call', ...input, requestId }, userId); }
        catch (error) {
          const call = pending.get(requestId);
          if (call) { pending.delete(requestId); call.cleanup(); reject(error); }
        }
      });
    },
    reply(userId: string, reply: FrontendLuaReply): boolean {
      const call = pending.get(reply.requestId);
      if (!call || call.userId !== userId || call.sessionId !== reply.sessionId) return false;
      pending.delete(reply.requestId);
      call.cleanup();
      if (reply.ok) call.resolve(reply.value);
      else call.reject(new FrontendLuaExecutionError(reply.error));
      return true;
    },
    disconnect(userId: string, sessionId: string): void {
      for (const [id, call] of pending) if (call.userId === userId && call.sessionId === sessionId) {
        cancel(id, new FrontendLuaUnavailableError('The browser owning this Lua operation disconnected'));
      }
    },
    dispose(): void {
      for (const id of [...pending.keys()]) cancel(id, new FrontendLuaUnavailableError('The Lua bridge stopped'));
    },
    get pendingCount() { return pending.size; },
  };
}
