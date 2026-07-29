import { makeDispatcherScriptNS } from '../interpreter/dispatcher.js';
import { makeRisuTriggerRuntime } from '../interpreter/runtime.js';
import { selectRestrictedTriggers } from '../interpreter/restricted-trigger.js';
import {
  interpretTrigger,
  type InterpConsole,
} from '../interpreter/trigger-interpreter.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { buildPreloaded, makeSnapshotHostApi } from './host-shim.js';
import type { DisplaySnapshot } from './snapshot.js';

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

  try {
    const runtime = await makeRisuTriggerRuntime(
      makeSnapshotHostApi(snap),
      {
        characterId: snap.characterId,
        characterName: snap.charName,
        userName: snap.userName,
      },
      makeDispatcherScriptNS(),
      {
        chatId: snap.chatId,
        characterId: snap.characterId,
        binding: 'display',
        displayMode: true,
        displayData: content,
        preloaded: buildPreloaded(snap),
      },
    );

    try {
      for (const trigger of triggers) {
        await interpretTrigger(trigger, runtime, triggerConsole, {
          displayMode: true,
          lowLevelAccess: Boolean(trigger.lowLevelAccess),
        });
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
  }
}
