// Risu scriptings.ts runLuaEditTrigger.
// Iterates all triggerlua triggers, threading data through each in sequence.

import type { HostApi, DispatchData, ScriptNS, TriggerRuntimePreloaded } from "./host.js";
import { makeRisuTriggerRuntime } from "./runtime.js";
import { errMsg } from "../util/coerce.js";
import { makeSafeLogger } from "../util/safe-log.js";
import { preloadForListenEditChain } from "./listenedit-preload.js";

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
  readonly chatId?: string;
  readonly characterId?: string;
  readonly resolveTemplate?: (text: string) => Promise<string>;
  readonly preloaded?: TriggerRuntimePreloaded;
  readonly wasmoonKey?: string;
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
    return luaTrigger && t.luaCode.length > 0;
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

  // PER-CHAIN PRELOAD: fetch chat-state ONCE for the whole chain instead of
  // once per trigger. Risu's listenEdit chain runs each trigger in a fresh
  // Lua VM (preserved); the data the Lua reads is identical across triggers
  // in the same chain (no chat mutations between triggers , editDisplay's
  // commit:false gates writes), so the snapshot is safely shareable.
  //
  // Mortal Realm: the per-trigger state reads (local/global vars + messages +
  // character/lorebook) collapse to one parallel preload + 16× Lua (or zero
  // state reads if the cross-chain cache hits), which kills the IPC channel
  // contention that caused 4.5s stalls in the editDisplay path.
  const tPreload = Date.now();
  const preloaded = opts.preloaded ?? await preloadForListenEditChain(
    api,
    opts.chatId,
    opts.characterId ?? null,
  );
  const preloadMs = Date.now() - tPreload;

  // Risu scriptings.ts uses a generator; character id is stable enough.
  const accessKey = opts.characterId ?? "edit-trigger";

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
          // Hand the per-chain snapshot to the runtime so it skips its own
          // repeated state fetches (local/global vars, messages, character/lorebook).
          preloaded,
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
      const result = await runtime.runLua(t.luaCode, {
        entry: "callListenMain",
        args: [mode, accessKey, valueJson, metaJson],
        ...(opts.wasmoonKey !== undefined ? { wasmoonKey: opts.wasmoonKey } : {}),
      });
      const runLuaMs = Date.now() - tRunLuaStart;
      totalRunLuaMs += runLuaMs;
      try {
        await runtime.flush();
      } catch (err) {
        log.warn(
          `trigger[${i}] mode=${mode} flush failed — ${errMsg(err)}; continuing chain`,
        );
      }
      if (typeof result === "string") {
        try {
          const parsed = JSON.parse(result) as T;
          current = parsed;
        } catch (err) {
          log.warn(
            `trigger[${i}] returned non-JSON, keeping prior value — ${errMsg(err)}`,
          );
        }
      } else if (result === undefined) {
        // No callListenMain defined; skip silently.
      } else {
        log.warn(
          `trigger[${i}] returned unexpected type=${typeof result}; keeping prior value`,
        );
      }
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
      // Risu scriptings.ts: on throw, keep prior value and continue.
      log.warn(
        `trigger[${i}] mode=${mode} elapsed=${Date.now() - tStart}ms THREW — ${errMsg(err)}; keeping prior value`,
      );
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
