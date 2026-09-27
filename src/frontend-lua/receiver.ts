import { FrontendLuaUnavailableError, type FrontendLuaCall, type FrontendLuaReply } from './protocol.js';

export function createFrontendLuaReceiver(
  sessionId: string,
  run: (call: FrontendLuaCall, signal: AbortSignal) => Promise<unknown>,
  send: (reply: FrontendLuaReply) => void,
) {
  const active = new Map<string, AbortController>();
  const received = new Set<string>();
  let disposed = false;

  return {
    async receive(message: FrontendLuaCall | { type: 'lua_cancel'; sessionId: string; requestId: string }): Promise<void> {
      if (disposed || message.sessionId !== sessionId) return;
      if (message.type === 'lua_cancel') {
        received.add(message.requestId);
        active.get(message.requestId)?.abort(new FrontendLuaUnavailableError('Lua operation was cancelled'));
        return;
      }
      if (received.has(message.requestId)) return;
      received.add(message.requestId);
      const controller = new AbortController();
      active.set(message.requestId, controller);
      const result = await Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return run(message, controller.signal);
      }).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
      active.delete(message.requestId);
      if (!disposed && !controller.signal.aborted) send({ type: 'lua_reply', sessionId, requestId: message.requestId, ...result });
    },
    dispose(): void {
      disposed = true;
      for (const controller of active.values()) controller.abort(new FrontendLuaUnavailableError('The browser Lua runtime stopped'));
      active.clear();
      received.clear();
    },
  };
}
