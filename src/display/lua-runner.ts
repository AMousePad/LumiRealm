import type { SpindleDisplayContext } from 'lumiverse-spindle-types';
import type { DispatchData, HostMessage, HostApi, TriggerRuntimeOpts } from '../interpreter/host.js';
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
import { applyVarDelta, getDisplaySnapshot, type DisplaySnapshot } from './snapshot.js';
import { makeDispatcherScriptNS, registerManualTriggers } from '../interpreter/dispatcher.js';
import { setWasmoonExecutor } from '../interpreter/runtime.js';
import { executeWasmoon } from '../interpreter/lua-wasmoon.js';
import { makeFrontendScriptNS } from '../frontend-lua/executor.js';
import { makeSafeLogger } from '../util/safe-log.js';

setWasmoonExecutor(executeWasmoon);
const varLog = makeSafeLogger('runtime.setVar');
let environment: ((snapshot: DisplaySnapshot) => { api: HostApi; options: TriggerRuntimeOpts; flush(): Promise<void> }) | undefined;

export function setDisplayLuaEnvironment(provider: typeof environment): void { environment = provider; }
export function getDisplayLuaEnvironment(snapshot: DisplaySnapshot) { return environment?.(snapshot); }

function risuChatIndex(context: SpindleDisplayContext, snap: DisplaySnapshot): number {
  return resolveRisuDisplayMessageIndex(snap, context);
}

export async function runEditDisplayChain(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
  resolveTemplate: (text: string) => string,
  onVarWrite: DisplayVarWriteback,
  onEffect?: DisplayRuntimeEffectSink,
  onVarRead?: (name: string, scope: 'chat' | 'global') => void,
  onMessageRead?: () => void,
): Promise<string> {
  if (snap.luaTriggers.length === 0) return content;
  const local = environment?.(snap);
  const api = local?.api ?? makeSnapshotHostApi(snap, onVarWrite, onEffect);
  const scriptNS = makeFrontendScriptNS();
  registerManualTriggers(scriptNS, snap.compiledLibraries, api);
  const data: DispatchData = {
    characterId: snap.characterId,
    characterName: snap.charName,
    userName: snap.userName,
  };
  const index = risuChatIndex(context, snap);
  let vars = snap.vars;
  const currentVars = () => getDisplaySnapshot(snap.chatId)?.vars ?? vars;
  const written = new Set<string>();
  try { return await runListenEditChain<string>(
    snap.luaTriggers,
    'editDisplay',
    content,
    { index },
    api,
    data,
    scriptNS,
    {
      preloaded: buildPreloaded(snap),
      luaVariables: {
        get(name, scope) {
          const values = currentVars()[scope === 'chat' ? 'local' : 'global'];
          const value = Object.hasOwn(values, name) ? values[name] : undefined;
          return value ?? (scope === 'chat' && Object.hasOwn(snap.scriptstateDefaults, name)
            ? snap.scriptstateDefaults[name]! : 'null');
        },
        set(name, value) {
          const current = currentVars();
          if (current.local[name] === value) return;
          vars = { ...current, local: { ...current.local, [name]: value } };
          applyVarDelta(snap.chatId, 'local', { [name]: value });
          written.add(name);
          varLog.info(`$${name}=${JSON.stringify(value.slice(0, 80))}`);
          return true;
        },
        flush() {
          // A later queued hook can already have written; persist its current value.
          // Only authored keys belong in the delta, never the preloaded variable bag.
          const current = currentVars().local;
          const delta: Record<string, string> = {};
          for (const key of written) if (typeof current[key] === 'string') delta[key] = current[key];
          written.clear();
          if (Object.keys(delta).length) onVarWrite(delta);
        },
      },
      // Risu owns one engine per hook mode and recreates it when source changes.
      wasmoonKey: 'editDisplay',
      ...(onVarRead ? { onVarRead } : {}),
      ...(onMessageRead ? { onMessageRead } : {}),
      ...local?.options,
      chatId: snap.chatId,
      characterId: snap.characterId,
      luaTemplate: resolveTemplate,
    },
  ); } finally { await local?.flush(); }
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
  const local = environment?.(snap);
  const api = local?.api ?? makeSnapshotHostApi(snap, undefined, options.onEffect);
  const role = (context.role ?? undefined) as HostMessage['role'] | undefined;
  try { return await runAtActionsForPhase(actions, 'editdisplay', content, {
    api,
    chatIndex: risuChatIndex(context, snap),
    ...(role ? { role } : {}),
    ...(options.resolveTemplate
      ? { resolveTemplate: options.resolveTemplate }
      : {}),
  }); } finally { await local?.flush(); }
}
