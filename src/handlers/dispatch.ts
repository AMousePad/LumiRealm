import type { Handler } from './types.js';

export interface DispatchHandlerDeps {
  readonly dispatchManualTrigger: (
    chatId: string,
    triggerName: string,
    triggerId: string | undefined,
    userId: string,
    frontendSessionId?: string,
  ) => Promise<void>;
  readonly dispatchButtonClick: (
    chatId: string,
    btn: string,
    btnId: string | undefined,
    userId: string,
    frontendSessionId?: string,
  ) => Promise<void>;
  readonly log: { readonly info: (m: string) => void };
}

export function createDispatchHandlers(deps: DispatchHandlerDeps): {
  readonly manual_trigger: Handler<'manual_trigger'>;
  readonly manual_button_click: Handler<'manual_button_click'>;
} {
  return {
    manual_trigger: async (msg, ctx) => {
      deps.log.info(`manual_trigger: triggerName=${msg.triggerName} triggerId=${msg.triggerId ?? '<none>'} chatId=${msg.chatId}`);
      await deps.dispatchManualTrigger(msg.chatId, msg.triggerName, msg.triggerId, ctx.userId, ctx.frontendSessionId);
    },
    manual_button_click: async (msg, ctx) => {
      deps.log.info(`manual_button_click: btn=${msg.btn} btnId=${msg.btnId ?? '<none>'} chatId=${msg.chatId}`);
      await deps.dispatchButtonClick(msg.chatId, msg.btn, msg.btnId, ctx.userId, ctx.frontendSessionId);
    },
  };
}
