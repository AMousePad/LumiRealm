import type { SpindleAPI } from 'lumiverse-spindle-types';
import { createFrontendLuaRpc } from './rpc.js';
import { FrontendLuaUnavailableError, type FrontendLuaOperation, type FrontendLuaReply } from './protocol.js';
import type { RuntimeBootstrap, RuntimeStateCommand, RuntimeStateDto, RuntimeStateWrite } from './state-contract.js';
import type { RuntimeServiceCall, RuntimeServiceReply } from './services.js';
import { makeSpindleHost } from '../interpreter/spindle-host.js';
import { readEffectiveGlobals } from '../state/toggle-preferences.js';
import { presetToggleValues } from '../state/preset-toggle-values.js';
import { createCharacterLoreEntry } from '../state/character-lorebook.js';
import { persistLocalLore, replaceLocalLore, type LocalLoreHost } from '../state/local-lore.js';
import { dropUnsupportedMessageTime, runtimeMessage } from './state-contract.js';
import { buildDisplayChatState } from '../state/display-snapshot-assembly.js';
import { setCachedMessages } from '../interpreter/messages-cache.js';
import { invalidateMacroInterceptorForChat } from '../state/macro-interceptor-cache.js';

export interface FrontendLuaHostContract {
  runtimeState: {
    read(chatId: string, characterId: string, userId: string): Promise<RuntimeStateDto>;
    write(chatId: string, command: RuntimeStateCommand, userId: string, mutationId: string): Promise<RuntimeStateWrite>;
  };
  sendToFrontend(payload: unknown, userId: string, options: { frontendSessionId: string }): void;
}

export function createFrontendLuaBackend(host: Omit<SpindleAPI, keyof FrontendLuaHostContract> & FrontendLuaHostContract, bootstrap: (chatId: string, characterId: string, userId: string) => Promise<Omit<RuntimeBootstrap, 'state' | 'hostSupport'>>) {
  for (const capability of ['frontend-session-routing-v1', 'runtime-state-v1', 'required-context-handlers-v1', 'required-interceptors-v1']) {
    if (!host.host?.capabilities?.[capability]) throw new FrontendLuaUnavailableError(`Frontend Lua requires Lumiverse capability: ${capability}`);
  }
  const send = (message: { sessionId: string }, userId: string) => host.sendToFrontend(message, userId, { frontendSessionId: message.sessionId });
  const rpc = createFrontendLuaRpc(send);
  async function readState(chatId: string, characterId: string, userId: string): Promise<RuntimeStateDto> {
    const state = await host.runtimeState.read(chatId, characterId, userId);
    return { ...state, globalVariables: await readEffectiveGlobals(userId, state.globalVariables, presetToggleValues(chatId, userId)) };
  }
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
            value = { ...config, state: await readState(call.chatId, call.characterId, userId), hostSupport: {
              messageMutations: Boolean(host.contracts?.runtimeMessageMutations),
              resolvedLore: typeof (host.world_books as { resolveForChat?: unknown } | undefined)?.resolveForChat === 'function',
            } };
            break;
          }
          case 'state.read': value = await readState(call.chatId, call.characterId, userId); break;
          case 'lore.resolve': {
            const state = await host.runtimeState.read(call.chatId, call.characterId, userId);
            setCachedMessages(call.chatId, buildDisplayChatState(state.messages.map(runtimeMessage)).messages!);
            invalidateMacroInterceptorForChat(call.chatId);
            value = await api().worldInfo!.resolveForChat!(call.request.reserveTokens);
            break;
          }
          case 'lore.createCharacter': {
            await host.runtimeState.read(call.chatId, call.characterId, userId);
            const entry = await createCharacterLoreEntry(host, call.characterId, userId, call.request.entry);
            value = { entry, state: await readState(call.chatId, call.characterId, userId) };
            break;
          }
          case 'state.write': {
            const command = dropUnsupportedMessageTime(call.request.command, host.contracts);
              if ((command.kind === 'message.create' || command.kind === 'message.edit') && command.ownContentMetadata !== undefined && !host.contracts?.runtimeMessageContentMetadata) {
                throw new FrontendLuaUnavailableError('Lua message data requires native content metadata');
              }
            if ((command.kind === 'message.create' || command.kind === 'message.edit') &&
              ((command.kind === 'message.edit' && command.role !== undefined) ||
                (command.kind === 'message.create' && command.beforeId !== undefined)) && !host.contracts?.runtimeMessageMutations) {
              throw new FrontendLuaUnavailableError('Lua message changes require native runtime message mutations');
            }
            if (call.request.command.kind === 'lore.upsertLocal' || call.request.command.kind === 'lore.replaceLocal') {
              await host.runtimeState.read(call.chatId, call.characterId, userId);
              if (call.request.command.kind === 'lore.upsertLocal') await persistLocalLore(host as typeof host & LocalLoreHost, call.chatId, userId, call.request.command.entry);
              else await replaceLocalLore(host as typeof host & LocalLoreHost, call.chatId, userId, call.request.command.entries);
              const state = await host.runtimeState.read(call.chatId, call.characterId, userId);
              value = { revision: state.revision, patch: { chat: state.chat }, value: undefined };
            } else value = await host.runtimeState.write(call.chatId, command, userId, call.request.mutationId);
            break;
          }
          case 'llm.generate': value = await api().llm!.generate(call.request.request); break;
          case 'connections.list': value = await api().llm!.listConnections!(); break;
          case 'tokens.count': value = await api().tokens!.count(call.request.text); break;
          case 'image.generate': value = await api().imageGen!.generate(call.request.prompt, call.request.options); break;
          case 'image.upload': value = await api().images!.uploadFromDataUrl(call.request.dataUrl, call.request.name); break;
          case 'request': {
            const response = await api().corsFetch!(call.request.url, { method: 'GET' });
            value = { status: response.status, body: response.text ? await response.text() : response.body };
            break;
          }
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
