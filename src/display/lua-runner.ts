import type { SpindleDisplayContext } from 'lumiverse-spindle-types';
import type { DispatchData, HostMessage } from '../interpreter/host.js';
import { runListenEditChain } from '../interpreter/listen-edit.js';
import {
  runAtActionsForPhase,
  type RuntimeAtAtAction,
} from '../interpreter/at-actions-runtime.js';
import {
  makeSnapshotHostApi,
  buildPreloaded,
  resolveRisuDisplayMessageIndex,
  type DisplayVarWriteback,
  type DisplayRuntimeEffectSink,
} from './host-shim.js';
import type { DisplaySnapshot } from './snapshot.js';
import { makeDispatcherScriptNS, registerManualTriggers } from '../interpreter/dispatcher.js';
import { setWasmoonExecutor } from '../interpreter/runtime.js';
import { executeWasmoon } from '../interpreter/lua-wasmoon.js';

setWasmoonExecutor(executeWasmoon);

function risuChatIndex(context: SpindleDisplayContext, snap: DisplaySnapshot): number {
  return resolveRisuDisplayMessageIndex(snap, context);
}

export async function runEditDisplayChain(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
  resolveTemplate: (text: string) => Promise<string>,
  onVarWrite: DisplayVarWriteback,
  onEffect?: DisplayRuntimeEffectSink,
  onVarRead?: (name: string, scope: 'chat' | 'global') => void,
): Promise<string> {
  if (snap.luaTriggers.length === 0) return content;
  const api = makeSnapshotHostApi(snap, onVarWrite, onEffect);
  const scriptNS = makeDispatcherScriptNS();
  registerManualTriggers(scriptNS, snap.compiledLibraries, api);
  const data: DispatchData = {
    characterId: snap.characterId,
    characterName: snap.charName,
    userName: snap.userName,
  };
  const index = risuChatIndex(context, snap);
  return runListenEditChain<string>(
    snap.luaTriggers,
    'editDisplay',
    content,
    { index },
    api,
    data,
    scriptNS,
    {
      chatId: snap.chatId,
      characterId: snap.characterId,
      resolveTemplate,
      preloaded: buildPreloaded(snap),
      // Risu owns one engine per hook mode and recreates it when source changes.
      wasmoonKey: 'editDisplay',
      ...(onVarRead ? { onVarRead } : {}),
    },
  );
}

export async function runEditDisplayAtActions(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
  actions: readonly RuntimeAtAtAction[] = snap.atActions,
  options: {
    readonly resolveTemplate?: (text: string) => string | Promise<string>;
    readonly onEffect?: DisplayRuntimeEffectSink;
  } = {},
): Promise<string> {
  if (actions.length === 0) return content;
  const api = makeSnapshotHostApi(snap, undefined, options.onEffect);
  const role = (context.role ?? undefined) as HostMessage['role'] | undefined;
  return runAtActionsForPhase(actions, 'editdisplay', content, {
    api,
    chatIndex: risuChatIndex(context, snap),
    ...(role ? { role } : {}),
    ...(options.resolveTemplate
      ? { resolveTemplate: options.resolveTemplate }
      : {}),
  });
}
