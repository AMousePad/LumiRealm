import type { ActiveCard } from '../interpreter/dispatch.js';
import type { RisuBinding } from '../interpreter/runtime.js';
import type { FrontendLuaOperation } from '../frontend-lua/protocol.js';
import { invalidateRenderMcpForChat } from './render-mcp-cache.js';
import { invalidateMacroInterceptorForChat } from './macro-interceptor-cache.js';

export interface TriggerDispatcherDeps {
  readonly execute: <T>(chatId: string, characterId: string, operation: FrontendLuaOperation, userId: string | undefined, sessionId: string | undefined, signal?: AbortSignal) => Promise<T>;
  readonly ensureActiveCardForChat: (chatId: string, characterId: string | null, userId: string | undefined) => Promise<ActiveCard | null>;
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string | undefined) => Promise<void>;
  readonly refreshVariables: (active: ActiveCard, chatId: string, userId: string | undefined, opts?: { force?: boolean; guiReload?: boolean }) => Promise<void>;
}

export function createTriggerDispatcher(deps: TriggerDispatcherDeps) {
  async function manual(chatId: string, operation: FrontendLuaOperation, userId: string | undefined, sessionId: string | undefined): Promise<void> {
    const active = await deps.ensureActiveCardForChat(chatId, null, userId);
    if (!active) throw new Error('The chat has no active Risu runtime');
    await deps.execute(chatId, active.card.character_id, operation, userId, sessionId);
    invalidateRenderMcpForChat(chatId);
    invalidateMacroInterceptorForChat(chatId);
    await deps.refreshBgHtml(active, chatId, userId);
    await deps.refreshVariables(active, chatId, userId);
  }
  return {
    async runBinding(active: ActiveCard, chatId: string, binding: RisuBinding, userId: string | undefined, sessionId?: string, signal?: AbortSignal): Promise<{ stopSending: boolean }> {
      if (!active.card.risuPayload.triggers.length) return { stopSending: false };
      return deps.execute(chatId, active.card.character_id, { kind: 'binding', binding }, userId, sessionId, signal);
    },
    dispatchManualTrigger: (chatId: string, name: string, _triggerId: string | undefined, userId: string | undefined, sessionId?: string) => manual(chatId, { kind: 'manual', name }, userId, sessionId),
    dispatchButtonClick: (chatId: string, value: string, _buttonId: string | undefined, userId: string | undefined, sessionId?: string) => manual(chatId, { kind: 'button', value }, userId, sessionId),
  };
}

export type TriggerDispatcher = ReturnType<typeof createTriggerDispatcher>;
