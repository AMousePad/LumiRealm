import type { SpindleDisplayContext } from 'lumiverse-spindle-types';
import type { DispatchData, HostMessage } from '../interpreter/host.js';
import { runListenEditChain } from '../interpreter/listen-edit.js';
import { runAtActionsForPhase } from '../interpreter/at-actions-runtime.js';
import {
  makeSnapshotHostApi,
  buildPreloaded,
  type DisplayVarWriteback,
} from './host-shim.js';
import type { DisplaySnapshot } from './snapshot.js';
import { makeDispatcherScriptNS, registerManualTriggers } from '../interpreter/dispatcher.js';
import { setWasmoonExecutor } from '../interpreter/runtime.js';
import { executeWasmoon } from '../interpreter/lua-wasmoon.js';

setWasmoonExecutor(executeWasmoon);

function risuChatIndex(context: SpindleDisplayContext, snap: DisplaySnapshot): number {
  if (typeof context.messageIndex === 'number') return context.messageIndex - 1;
  const dyn = context.dynamicMacros;
  const chatIndexStr = dyn?.chat_index;
  if (typeof chatIndexStr === 'string' && /^-?\d+$/.test(chatIndexStr)) return parseInt(chatIndexStr, 10) - 1;
  return snap.chat.lastMessageId - 1;
}

export async function runEditDisplayChain(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
  resolveTemplate: (text: string) => Promise<string>,
  onVarWrite: DisplayVarWriteback,
): Promise<string> {
  if (snap.luaTriggers.length === 0) return content;
  const api = makeSnapshotHostApi(snap, onVarWrite);
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
      wasmoonKey: snap.characterId,
    },
  );
}

export async function runEditDisplayAtActions(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
): Promise<string> {
  if (snap.atActions.length === 0) return content;
  const api = makeSnapshotHostApi(snap);
  const role = (context.role ?? undefined) as HostMessage['role'] | undefined;
  return runAtActionsForPhase(snap.atActions, 'editdisplay', content, {
    api,
    chatIndex: risuChatIndex(context, snap),
    ...(role ? { role } : {}),
  });
}
