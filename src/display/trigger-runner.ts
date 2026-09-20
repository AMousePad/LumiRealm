import { makeFrontendScriptNS } from '../frontend-lua/executor.js';
import { makeRisuTriggerRuntime } from '../interpreter/runtime.js';
import { selectRestrictedTriggers } from '../interpreter/restricted-trigger.js';
import {
  interpretTrigger,
  type InterpConsole,
} from '../interpreter/trigger-interpreter.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { buildPreloaded, makeSnapshotHostApi } from './host-shim.js';
import type { DisplaySnapshot } from './snapshot.js';
import { getDisplayLuaEnvironment } from './lua-runner.js';

const log = makeSafeLogger('display-trigger');

function formatConsoleArgs(args: readonly unknown[]): string {
  return args
    .map((value) => {
      try {
        return typeof value === 'string' ? value : JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(' ')
    .slice(0, 600);
}

const triggerConsole: InterpConsole = {
  log: (...args) => log.info(`console.log: ${formatConsoleArgs(args)}`),
  warn: (...args) => log.warn(`console.warn: ${formatConsoleArgs(args)}`),
  error: (...args) => log.error(`console.error: ${formatConsoleArgs(args)}`),
  info: (...args) => log.info(`console.info: ${formatConsoleArgs(args)}`),
};

export interface DisplayTriggerChainResult {
  readonly content: string;
  readonly ran: boolean;
}

export async function runDisplayTriggerChain(
  snap: DisplaySnapshot,
  content: string,
): Promise<DisplayTriggerChainResult> {
  const triggers = selectRestrictedTriggers(
    snap.luaTriggers.map((entry) => entry.source),
    'display',
  );
  if (triggers.length === 0) return { content, ran: false };
  const local = getDisplayLuaEnvironment(snap);
  const { luaChat: _chat, luaVariables: _variables, ...options } = local?.options ?? {};

  try {
    const runtime = await makeRisuTriggerRuntime(
      local?.api ?? makeSnapshotHostApi(snap),
      {
        characterId: snap.characterId,
        characterName: snap.charName,
        userName: snap.userName,
      },
      makeFrontendScriptNS(),
      {
        chatId: snap.chatId,
        characterId: snap.characterId,
        binding: 'display',
        displayMode: true,
        displayData: content,
        preloaded: buildPreloaded(snap),
        ...options,
        templateContext: async () => ({
          ...snap, character: snap.character, chat: snap.chat, variables: snap.vars, commit: false,
        }),
      },
    );

    try {
      for (const trigger of triggers) {
        const result = await interpretTrigger(trigger, runtime, triggerConsole, {
          displayMode: true,
          lowLevelAccess: Boolean(trigger.lowLevelAccess),
        });
        if (result === 'abort') return { content, ran: true };
      }
      return { content: runtime.getDisplayState(), ran: true };
    } catch (err) {
      log.warn(`display trigger chain failed: ${String(err)}`);
      return { content, ran: true };
    } finally {
      await runtime.flush();
    }
  } catch (err) {
    log.warn(`display trigger runtime failed: ${String(err)}`);
    return { content, ran: true };
  } finally { await local?.flush(); }
}
