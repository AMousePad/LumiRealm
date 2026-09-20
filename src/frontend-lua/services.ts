import { v4 } from 'uuid';
import type { RuntimeService } from './state-contract.js';
import { FrontendLuaUnavailableError, FrontendLuaExecutionError } from './protocol.js';

export interface RuntimeServiceCall {
  type: 'lua_service'; requestId: string; chatId: string; characterId: string; request: RuntimeService;
}
export type RuntimeServiceReply = { type: 'lua_service_reply'; requestId: string }
  & ({ ok: true; value: unknown } | { ok: false; error: string });

export function createRuntimeServices(send: (request: RuntimeServiceCall) => void) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  return {
    call<T>(chatId: string, characterId: string, request: RuntimeService): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const requestId = v4();
        pending.set(requestId, { resolve: value => resolve(value as T), reject });
        try { send({ type: 'lua_service', requestId, chatId, characterId, request }); }
        catch (error) { pending.delete(requestId); reject(error); }
      });
    },
    receive(reply: RuntimeServiceReply): void {
      const request = pending.get(reply.requestId);
      if (!request) return;
      pending.delete(reply.requestId);
      if (reply.ok) request.resolve(reply.value);
      else request.reject(new FrontendLuaExecutionError(reply.error));
    },
    dispose(): void {
      for (const request of pending.values()) request.reject(new FrontendLuaUnavailableError('The frontend Lua service connection closed'));
      pending.clear();
    },
  };
}
