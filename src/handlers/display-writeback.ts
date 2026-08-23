declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { Handler } from './types.js';
import { expectChatChange } from '../state/own-chat-change.js';
import { invalidateMacroInterceptorForVars } from '../state/macro-interceptor-cache.js';
import { invalidateRecentFlush } from '../state/recent-flush-cache.js';
import { runChatMetadataExclusive } from '../state/chat-metadata-queue.js';

export function createDisplayWritebackHandlers(): { display_writeback: Handler<'display_writeback'> } {
  return {
    display_writeback: async (msg, ctx): Promise<void> => {
      const { chatId, vars } = msg;
      if (!chatId || !vars || Object.keys(vars).length === 0) return;
      try {
        await runChatMetadataExclusive(chatId, async () => {
          const chat = await spindle.chats.get(chatId, ctx.userId);
          const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
          const cv = (meta['chat_variables'] && typeof meta['chat_variables'] === 'object'
            ? { ...(meta['chat_variables'] as Record<string, unknown>) }
            : {}) as Record<string, unknown>;
          let changed = 0;
          for (const [k, v] of Object.entries(vars)) {
            if (cv[k] === v) continue;
            cv[k] = v;
            changed += 1;
          }
          if (changed === 0) return;
          expectChatChange(chatId);
          await spindle.chats.update(chatId, { metadata: { ...meta, chat_variables: cv } as never }, ctx.userId);
          invalidateRecentFlush(chatId);
          // Own-write echo is consumed upstream (no set_variables follows);
          // purge prompt-time interceptor entries that read these vars using
          // their recorded touchedVars — never the whole chat.
          invalidateMacroInterceptorForVars(
            chatId,
            Object.keys(vars).flatMap((k) => [`local:${k}`, `chat:${k}`]),
          );
          ctx.log.info(`display_writeback chat=${chatId} changed=${changed}`);
        });
      } catch (err) {
        ctx.log.warn(`display_writeback failed chat=${chatId}: ${ctx.errMsg(err)}`);
      }
    },
  };
}
