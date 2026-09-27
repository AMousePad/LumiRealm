import { prepareTriggerSources } from '../../src/interpreter/dispatcher.js';
import { makeSpindleHost } from '../../src/interpreter/spindle-host.js';
import { runFrontendLuaOperation } from '../../src/frontend-lua/executor.js';
import type { FrontendLuaOperation } from '../../src/frontend-lua/protocol.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import { coerceAtActions } from '../../src/interpreter/at-actions-runtime.js';
import { basicTriggerContext } from './trigger-runtime.js';

export function frontendExecutorFor(active: (chatId: string) => ActiveCard | undefined) {
  return async function execute<T>(chatId: string, characterId: string, operation: FrontendLuaOperation, userId: string | undefined, _sessionId?: string, signal = new AbortController().signal): Promise<T> {
    const card = active(chatId);
    if (!card) throw new Error('Missing test runtime');
    const payload = card.card.risuPayload;
    const triggers = payload.triggers as readonly TriggerScript[];
    return runFrontendLuaOperation(operation, {
      api: makeSpindleHost({ chatId, characterId, userId }), data: { characterId },
      prepareRuntime: () => ({ chatId, characterId, templateContext: basicTriggerContext }),
      compiled: prepareTriggerSources(triggers, characterId),
      triggers: triggers.map((source, index) => ({ source, luaCode: payload.lua_scripts[index] ?? '' })),
      atActions: coerceAtActions(payload.at_actions),
    }, signal) as Promise<T>;
  };
}
