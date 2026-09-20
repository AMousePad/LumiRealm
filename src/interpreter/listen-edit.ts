// Risu scriptings.ts runLuaEditTrigger.
// Iterates all triggerlua triggers, threading data through each in sequence.

import type { HostApi, DispatchData, ScriptNS, TriggerRuntimeOpts, TriggerRuntimePreloaded } from "./host.js";
import { makeRisuTriggerRuntime } from "./runtime.js";
import { errMsg } from "../util/coerce.js";
import { makeSafeLogger } from "../util/safe-log.js";
import { preloadForListenEditChain } from "./listenedit-preload.js";
import { LuaChunkError } from './lua-engine.js';
import { commitInvocation, type TriggerInvocationState } from './runtime/invocation.js';
import { prepareLuaHostState } from './runtime/lua-state.js';

const log = makeSafeLogger("listenEdit.runChain");

export type ListenEditMode =
  | "editInput"
  | "editOutput"
  | "editDisplay"
  | "editRequest";

export interface ListenEditTrigger {
  readonly source: { effect?: ReadonlyArray<{ type?: string }> };
  readonly luaCode: string;
}

export interface ListenEditOpts {
  readonly luaSignal?: AbortSignal;
  readonly chatId?: string;
  readonly characterId?: string;
  readonly resolveTemplate?: (text: string) => Promise<string>;
  readonly luaTemplate?: TriggerRuntimeOpts['luaTemplate'];
  readonly templateContext?: TriggerRuntimeOpts['templateContext'];
  readonly preloaded?: TriggerRuntimePreloaded;
  readonly wasmoonKey?: string;
  readonly onVarRead?: (name: string, scope: 'chat' | 'global') => void;
  readonly onMessageRead?: () => void;
  readonly luaVariables?: TriggerRuntimeOpts['luaVariables'];
  readonly luaChat?: TriggerRuntimeOpts['luaChat'];
}

export async function runListenEditChain<T>(
  triggers: readonly ListenEditTrigger[],
  mode: ListenEditMode,
  value: T,
  meta: Record<string, unknown>,
  api: HostApi,
  data: DispatchData,
  scriptNS: ScriptNS,
  opts: ListenEditOpts = {},
): Promise<T> {
  // Risu scriptings.ts: skip non-triggerlua effect kinds.
  const eligible = triggers.filter((t) => {
    const luaTrigger = t.source.effect?.[0]?.type === "triggerlua";
    return luaTrigger;
  });
  if (eligible.length === 0) return value;

  let effApi: HostApi = api;
  if (mode === 'editDisplay') {
    const { tokens: _tokens, ...rest } = api;
    void _tokens;
    effApi = rest;
  }

  const chainStart = Date.now();
  // valueLen is what we ship to the Lua across the JSON wire , the actual
  // payload size matters for both Lua-bridge ser/de cost and downstream
  // parse cost on each trigger.
  log.trace(
    `chain.start mode=${mode} eligible=${eligible.length}/${triggers.length} ` +
      `value_len=${typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : -1} ` +
      `chatId=${opts.chatId ?? "<none>"} characterId=${opts.characterId ?? "<none>"}`,
  );

  // Reuse preloaded context across the chain; frontend Lua variables use
  // the caller's live accessors instead of that snapshot.
  const tPreload = Date.now();
  const snapshot = opts.preloaded ?? await preloadForListenEditChain(
    api,
    opts.chatId,
    opts.characterId ?? null,
  );
  const preloaded = { ...snapshot, luaState: snapshot.luaState ?? await prepareLuaHostState(api, opts.characterId) };
  const templateInput = opts.templateContext ? await opts.templateContext() : undefined;
  const invocationState: TriggerInvocationState = { stopSending: false };
  const preloadMs = Date.now() - tPreload;

  let current = value;
  // Per-step timing buckets so the post-chain summary attributes wall clock
  // to factory work vs. Lua execute vs. JSON ser/de.
  let totalFactoryMs = 0;
  let totalRunLuaMs = 0;
  let totalSerdeMs = 0;

  for (let i = 0; i < eligible.length; i++) {
    const t = eligible[i]!;
    const tStart = Date.now();
    try {
      // Risu scriptings.ts: lowLevelAccess false; edit hooks are text transforms.
      const tFactoryStart = Date.now();
      const runtime = await makeRisuTriggerRuntime(
        effApi,
        data,
        scriptNS,
        {
          binding: "manual",
          lowLevelAccess: false,
          ...(opts.chatId !== undefined ? { chatId: opts.chatId } : {}),
          ...(opts.characterId !== undefined ? { characterId: opts.characterId } : {}),
          ...(opts.resolveTemplate !== undefined ? { resolveTemplate: opts.resolveTemplate } : {}),
          ...(opts.onVarRead !== undefined ? { onVarRead: opts.onVarRead } : {}),
          ...(opts.onMessageRead ? { onMessageRead: opts.onMessageRead } : {}),
          ...(opts.luaVariables !== undefined ? { luaVariables: opts.luaVariables } : {}),
          // Hand the per-chain snapshot to the runtime so it skips its own
          // repeated state fetches (local/global vars, messages, character/lorebook).
          preloaded,
          ...(opts.luaChat ? { luaChat: opts.luaChat } : { invocationState }),
          ...(opts.luaSignal ? { luaSignal: opts.luaSignal } : {}),
          ...(templateInput ? { templateContext: async () => templateInput } : {}),
          ...(opts.luaTemplate ? { luaTemplate: opts.luaTemplate } : {}),
        },
      );
      const factoryMs = Date.now() - tFactoryStart;
      totalFactoryMs += factoryMs;
      const tSerdeStart = Date.now();
      const valueJson = JSON.stringify(current);
      const metaJson = JSON.stringify(meta ?? {});
      const serdeMs = Date.now() - tSerdeStart;
      totalSerdeMs += serdeMs;
      const tRunLuaStart = Date.now();
      let result: unknown;
      try {
        result = await runtime.runLua(t.luaCode, {
          entry: "callListenMain",
          args: [mode, undefined, valueJson, metaJson],
          data: current,
          ...(opts.wasmoonKey !== undefined ? { wasmoonKey: opts.wasmoonKey } : {}),
        });
      } finally {
        await runtime.flush();
        if (!opts.luaChat) await commitInvocation(invocationState, opts.chatId);
      }
      const runLuaMs = Date.now() - tRunLuaStart;
      totalRunLuaMs += runLuaMs;
      current = (result ?? current) as T;
      const triggerTotal = Date.now() - tStart;
      // Per-trigger breakdown , when triggerTotal >> (factory+serde+runLua),
      // the gap is JS event loop time spent on concurrently queued Spindle
      // IPC (e.g. Lumi's display-regex pipeline calling our macroInterceptor
      // on adjacent fragments while we're awaiting). That "queued" cost is
      // not under listenEdit's control; the factory cost IS.
      const otherMs = triggerTotal - factoryMs - serdeMs - runLuaMs;
      log.trace(
        `trigger[${i}] mode=${mode} elapsed=${triggerTotal}ms ` +
          `factory=${factoryMs}ms serde=${serdeMs}ms runLua=${runLuaMs}ms ` +
          `other=${otherMs}ms (lua_len=${t.luaCode.length})`,
      );
    } catch (err) {
      if (!(err instanceof LuaChunkError)) throw err;
      log.error(`trigger[${i}] mode=${mode} chunk failed: ${errMsg(err)}; restoring original input`);
      return value;
    }
  }

  const chainTotal = Date.now() - chainStart;
  log.trace(
    `chain.done mode=${mode} elapsed=${chainTotal}ms eligible=${eligible.length} ` +
      `preload=${preloadMs}ms ` +
      `factory_sum=${totalFactoryMs}ms runLua_sum=${totalRunLuaMs}ms ` +
      `serde_sum=${totalSerdeMs}ms ` +
      `other=${chainTotal - preloadMs - totalFactoryMs - totalRunLuaMs - totalSerdeMs}ms ` +
      `chatId=${opts.chatId ?? '<none>'}`,
  );

  return current;
}
