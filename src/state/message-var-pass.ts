// Risu runCurrentChatFunction parity: at generation start + end, execute + strip
// the setvar family from stored message text, persisting each var to
// chat_variables. The strip is the run-once guard (the macro is gone next pass),
// and other macros stay raw so per-render display keeps resolving them.

import { makeSpindleHost } from '../interpreter/spindle-host.js';
import { loadVars, saveVars } from '../interpreter/runtime/chat-state.js';
import { rememberOurWrite } from './recent-writes.js';

export interface MessageVarPassDeps {
  readonly stripMessageSetvars: (
    chatId: string,
    characterId: string,
    userId: string,
  ) => Promise<{
    readonly changed: ReadonlyArray<{ readonly id: string; readonly content: string }>;
    readonly varWrites: ReadonlyArray<readonly [string, string | null]>;
  }>;
  readonly refreshMessagesCache: (chatId: string, userId: string | undefined) => Promise<void>;
  readonly invalidateRenderMcpForChat: (chatId: string) => void;
  readonly invalidateMacroInterceptorForChat: (chatId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface MessageVarPass {
  readonly run: (chatId: string, characterId: string, userId: string) => Promise<void>;
}

export function createMessageVarPass(deps: MessageVarPassDeps): MessageVarPass {
  const inflight = new Map<string, Promise<void>>();

  function run(chatId: string, characterId: string, userId: string): Promise<void> {
    const existing = inflight.get(chatId);
    if (existing) return existing;
    const task = runInner(chatId, characterId, userId).finally(() => {
      inflight.delete(chatId);
    });
    inflight.set(chatId, task);
    return task;
  }

  async function runInner(chatId: string, characterId: string, userId: string): Promise<void> {
    let changed: ReadonlyArray<{ id: string; content: string }>;
    let varWrites: ReadonlyArray<readonly [string, string | null]>;
    try {
      ({ changed, varWrites } = await deps.stripMessageSetvars(chatId, characterId, userId));
    } catch (err) {
      deps.log.warn(`runVarStrip: stripMessageSetvars failed chat=${chatId}: ${deps.errMsg(err)}`);
      return;
    }
    if (changed.length === 0 && varWrites.length === 0) return;

    const api = makeSpindleHost({ chatId, characterId, userId });

    // Persist BEFORE the message writeback. Callers run this after trigger
    // dispatch, so loadVars already reflects trigger writes and we merge on top.
    if (varWrites.length > 0) {
      try {
        const current = await loadVars(api, chatId);
        for (const [name, value] of varWrites) {
          const key = '$' + name;
          if (value === null) delete current[key];
          else current[key] = value;
        }
        await saveVars(api, current, chatId);
      } catch (err) {
        deps.log.warn(`runVarStrip: var persist failed chat=${chatId}: ${deps.errMsg(err)}`);
      }
    }

    let wrote = 0;
    for (const m of changed) {
      try {
        // Register the echo filter before the write so MESSAGE_EDITED can't race it.
        rememberOurWrite(chatId, m.id, m.content);
        await api.chat.editMessage(m.id, m.content);
        wrote += 1;
      } catch (err) {
        deps.log.warn(`runVarStrip: editMessage failed chat=${chatId} msg=${m.id}: ${deps.errMsg(err)}`);
      }
    }

    if (wrote > 0) {
      await deps.refreshMessagesCache(chatId, userId);
      deps.invalidateRenderMcpForChat(chatId);
      deps.invalidateMacroInterceptorForChat(chatId);
    }
    deps.log.info(`runVarStrip: chat=${chatId} strippedMsgs=${wrote} varWrites=${varWrites.length}`);
  }

  return { run };
}
