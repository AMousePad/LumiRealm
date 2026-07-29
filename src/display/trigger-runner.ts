import type { TriggerEffect, TriggerScript } from '../core/schemas/triggerscript.js';
import { makeDispatcherScriptNS } from '../interpreter/dispatcher.js';
import { makeRisuTriggerRuntime } from '../interpreter/runtime.js';
import {
  interpretTrigger,
  type InterpConsole,
} from '../interpreter/trigger-interpreter.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { buildPreloaded, makeSnapshotHostApi } from './host-shim.js';
import type { DisplaySnapshot } from './snapshot.js';

const log = makeSafeLogger('display-trigger');

// Risu triggers.ts displayAllowList. v2Loop is retained as structural glue:
// Risu skips its opcode but v2EndIndent still jumps back to it.
const DISPLAY_EFFECT_TYPES = new Set<string>([
  'v2GetDisplayState',
  'v2SetDisplayState',
  'v2SetVar',
  'v2If',
  'v2IfAdvanced',
  'v2Else',
  'v2EndIndent',
  'v2Loop',
  'v2LoopNTimes',
  'v2BreakLoop',
  'v2ConsoleLog',
  'v2StopTrigger',
  'v2Random',
  'v2ExtractRegex',
  'v2RegexTest',
  'v2GetCharAt',
  'v2GetCharCount',
  'v2ToLowerCase',
  'v2ToUpperCase',
  'v2SetCharAt',
  'v2SplitString',
  'v2JoinArrayVar',
  'v2ConcatString',
  'v2MakeArrayVar',
  'v2GetArrayVarLength',
  'v2GetArrayVar',
  'v2SetArrayVar',
  'v2PushArrayVar',
  'v2PopArrayVar',
  'v2ShiftArrayVar',
  'v2UnshiftArrayVar',
  'v2SpliceArrayVar',
  'v2SliceArrayVar',
  'v2GetIndexOfValueInArrayVar',
  'v2RemoveIndexFromArrayVar',
  'v2Calculate',
  'v2Comment',
  'v2DeclareLocalVar',
]);

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

function matchesDisplayBinding(source: TriggerScript): boolean {
  const firstType = source.effect?.[0]?.type;
  return firstType === 'triggerlua'
    || firstType === 'triggercode'
    || source.type === 'display';
}

function displaySafeSource(source: TriggerScript): TriggerScript {
  return {
    ...source,
    effect: source.effect.map((effect) => {
      if (DISPLAY_EFFECT_TYPES.has(effect.type)) return effect;
      const indent = 'indent' in effect && typeof effect.indent === 'number'
        ? effect.indent
        : 0;
      return { type: 'v2Comment', value: '', indent } as TriggerEffect;
    }),
  };
}

function matchingDisplayTriggers(snap: DisplaySnapshot): readonly TriggerScript[] {
  return snap.luaTriggers
    .map((entry) => entry.source)
    .filter(matchesDisplayBinding)
    .map(displaySafeSource)
    .filter(
      (source) =>
        source.conditions.length > 0
        || source.effect.some((effect) => effect.type !== 'v2Comment'),
    );
}

export async function runDisplayTriggerChain(
  snap: DisplaySnapshot,
  content: string,
): Promise<DisplayTriggerChainResult> {
  const triggers = matchingDisplayTriggers(snap);
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
