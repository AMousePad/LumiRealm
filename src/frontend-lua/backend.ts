import type { SpindleAPI } from 'lumiverse-spindle-types';
import { createFrontendLuaRpc } from './rpc.js';
import { FrontendLuaUnavailableError, type FrontendLuaOperation, type FrontendLuaReply } from './protocol.js';
import type { RuntimeBootstrap, RuntimeStateCommand, RuntimeStateDto, RuntimeStateWrite } from './state-contract.js';
import type { RuntimeServiceCall, RuntimeServiceReply } from './services.js';
import { makeSpindleHost } from '../interpreter/spindle-host.js';

export interface FrontendLuaHostContract {
  runtimeState: {
    read(chatId: string, characterId: string, userId: string): Promise<RuntimeStateDto>;
    write(chatId: string, command: RuntimeStateCommand, userId: string, mutationId: string): Promise<RuntimeStateWrite>;
  };
  sendToFrontend(payload: unknown, userId: string, options: { frontendSessionId: string }): void;
}

export function createFrontendLuaBackend(host: SpindleAPI & FrontendLuaHostContract, bootstrap: (chatId: string, characterId: string, userId: string) => Promise<Omit<RuntimeBootstrap, 'state'>>) {
  for (const capability of ['frontend-session-routing-v1', 'runtime-state-v1', 'required-context-handlers-v1', 'required-interceptors-v1']) {
    if (!host.host?.capabilities?.[capability]) throw new FrontendLuaUnavailableError(`Frontend Lua requires Lumiverse capability: ${capability}`);
  }
  const send = (message: { sessionId: string }, userId: string) => host.sendToFrontend(message, userId, { frontendSessionId: message.sessionId });
  const rpc = createFrontendLuaRpc(send);
  return {
    async call<T>(chatId: string, characterId: string, operation: FrontendLuaOperation, userId: string | undefined, sessionId: string | undefined, signal?: AbortSignal): Promise<T> {
      if (!sessionId || !userId) throw new FrontendLuaUnavailableError('Lua execution requires an active browser tab');
      return rpc.call(userId, { chatId, characterId, operation, sessionId }, { timeoutMs: 120_000, ...(signal ? { signal } : {}) }) as Promise<T>;
    },
    async receive(raw: unknown, userId: string, sessionId: string | undefined): Promise<boolean> {
      if (!raw || typeof raw !== 'object') return false;
      const message = raw as { type?: string };
      if (message.type === 'lua_reply') {
        const reply = raw as FrontendLuaReply;
        if (sessionId && reply.sessionId === sessionId) rpc.reply(userId, reply);
        return true;
      }
      if (message.type !== 'lua_service') return false;
      if (!sessionId) throw new FrontendLuaUnavailableError('Lua services require an authenticated browser session');
      const call = raw as RuntimeServiceCall;
      let reply: RuntimeServiceReply;
      try {
        const api = () => makeSpindleHost({ chatId: call.chatId, characterId: call.characterId, userId });
        let value: unknown;
        switch (call.request.kind) {
          case 'bootstrap': {
            const config = await bootstrap(call.chatId, call.characterId, userId);
            value = { ...config, state: await host.runtimeState.read(call.chatId, call.characterId, userId) };
            break;
          }
          case 'state.read': value = await host.runtimeState.read(call.chatId, call.characterId, userId); break;
          case 'state.write': value = await host.runtimeState.write(call.chatId, call.request.command, userId, call.request.mutationId); break;
          case 'llm.generate': value = await api().llm!.generate(call.request.request); break;
          case 'connections.list': value = await api().llm!.listConnections!(); break;
          case 'tokens.count': value = await api().tokens!.count(call.request.text); break;
          case 'chat.inject': value = await api().chat.inject(call.request.id, call.request.content, call.request.options); break;
          default: throw new FrontendLuaUnavailableError('Unknown Lua host service');
        }
        reply = { type: 'lua_service_reply', requestId: call.requestId, ok: true, value };
      } catch (error) {
        reply = { type: 'lua_service_reply', requestId: call.requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      host.sendToFrontend(reply, userId, { frontendSessionId: sessionId });
      return true;
    },
    disconnect: rpc.disconnect,
    dispose: rpc.dispose,
  };
}
