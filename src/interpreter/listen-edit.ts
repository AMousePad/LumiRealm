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
  /** Module lore rows for the active card; the preloaded snapshot has only the character's own books. */
  readonly moduleLorebooks?: readonly unknown[];
  readonly wasmoonKey?: string;
  readonly onVarRead?: (name: string, scope: 'chat' | 'global') => void;
  /**
   * Diagnostics only: wall-clock thresholds (ms) at which the chain reports
   * its slow-path breakdown without trace level being on. Defaults are the
   * production values; tests lower them so a fast chain still exercises the
   * report shape.
   */
  readonly slowTriggerWarnMs?: number;
  readonly slowChainWarnMs?: number;
}

// ─── Slow-path attribution ────────────────────────────────────────────────
//
// The host gives an interceptor a fixed wall-clock budget (10s by default) and
// drops the *entire* result when it overruns, keeping the pre-interceptor
// messages (interceptor-pipeline.ts catches the timeout and continues). A slow
// listenEdit chain therefore surfaces as one console error and a silently
// un-mutated prompt. These probes exist to name the culprit: they time every
// HostApi call and every resolveTemplate (`cbs`) call the chain makes, so an
// overrun report separates host-RPC wait from pure Lua execution.
const SLOW_TRIGGER_WARN_MS = 2_500;
const SLOW_CHAIN_WARN_MS = 6_000;

interface CallStat {
  calls: number;
  ms: number;
}

interface ChainProbe {
  readonly api: Map<string, CallStat>;
  readonly template: CallStat;
  wrapApi<T extends object>(api: T): T;
  wrapTemplate(
    fn: ((text: string) => Promise<string>) | undefined,
  ): ((text: string) => Promise<string>) | undefined;
  apiMs(): number;
  apiCalls(): number;
  topApi(n: number): string;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function createChainProbe(): ChainProbe {
  const api = new Map<string, CallStat>();
  const template: CallStat = { calls: 0, ms: 0 };

  function bump(name: string, ms: number): void {
    const stat = api.get(name) ?? { calls: 0, ms: 0 };
    stat.calls += 1;
    stat.ms += ms;
    api.set(name, stat);
  }

  // Copies the HostApi tree, timing every leaf function. The original function
  // is invoked with its own object as `this` and its return value is passed
  // through untouched, so a wrapped API is behaviourally identical.
  function wrapFns<T extends object>(source: T, prefix: string): T {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const value = (source as Record<string, unknown>)[key];
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'function') {
        const fn = value as (...args: unknown[]) => unknown;
        out[key] = async (...args: unknown[]): Promise<unknown> => {
          const t0 = Date.now();
          try {
            return await fn.apply(source, args);
          } finally {
            bump(name, Date.now() - t0);
          }
        };
      } else if (isPlainRecord(value)) {
        out[key] = wrapFns(value, name);
      } else {
        out[key] = value;
      }
    }
    return out as T;
  }

  return {
    api,
    template,
    wrapApi: (source) => wrapFns(source, ''),
    wrapTemplate: (fn) => {
      if (fn === undefined) return undefined;
      return async (text: string) => {
        const t0 = Date.now();
        try {
          return await fn(text);
        } finally {
          template.calls += 1;
          template.ms += Date.now() - t0;
        }
      };
    },
    apiMs: () => {
      let sum = 0;
      for (const stat of api.values()) sum += stat.ms;
      return sum;
    },
    apiCalls: () => {
      let sum = 0;
      for (const stat of api.values()) sum += stat.calls;
      return sum;
    },
    topApi: (n) =>
      [...api.entries()]
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, n)
        .map(([name, stat]) => `${name}=${stat.calls}calls/${stat.ms}ms`)
        .join(', '),
  };
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
  // On a 16-trigger listenEdit chain, the per-trigger state reads (local/global
  // vars + messages + character/lorebook) collapse to one parallel preload +
  // 16x Lua (or zero state reads if the cross-chain cache hits), which kills
  // the IPC channel contention that caused 4.5s stalls in the editDisplay path.
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
  let totalApiMs = 0;
  let totalApiCalls = 0;
  let totalCbsCalls = 0;
  let totalCbsMs = 0;

  for (let i = 0; i < eligible.length; i++) {
    const t = eligible[i]!;
    const tStart = Date.now();
    try {
      // Risu scriptings.ts: lowLevelAccess false; edit hooks are text transforms.
      const tFactoryStart = Date.now();
      const probe = createChainProbe();
      const apiMsBefore = probe.apiMs();
      const apiCallsBefore = probe.apiCalls();
      const cbsCallsBefore = probe.template.calls;
      const cbsMsBefore = probe.template.ms;
      const runtime = await makeRisuTriggerRuntime(
        probe.wrapApi(effApi),
        data,
        scriptNS,
        {
          binding: "manual",
          lowLevelAccess: false,
          ...(opts.chatId !== undefined ? { chatId: opts.chatId } : {}),
          ...(opts.characterId !== undefined ? { characterId: opts.characterId } : {}),
          ...(opts.resolveTemplate !== undefined
            ? { resolveTemplate: probe.wrapTemplate(opts.resolveTemplate) as (text: string) => Promise<string> }
            : {}),
          ...(opts.onVarRead !== undefined ? { onVarRead: opts.onVarRead } : {}),
          ...(opts.moduleLorebooks !== undefined ? { moduleLorebooks: opts.moduleLorebooks } : {}),
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
      const apiMs = probe.apiMs() - apiMsBefore;
      const apiCalls = probe.apiCalls() - apiCallsBefore;
      const cbsCalls = probe.template.calls - cbsCallsBefore;
      const cbsMs = probe.template.ms - cbsMsBefore;
      totalApiMs += apiMs;
      totalApiCalls += apiCalls;
      totalCbsCalls += cbsCalls;
      totalCbsMs += cbsMs;
      log.trace(
        `trigger[${i}] mode=${mode} elapsed=${triggerTotal}ms ` +
          `factory=${factoryMs}ms serde=${serdeMs}ms runLua=${runLuaMs}ms ` +
          `api=${apiMs}ms/${apiCalls} cbs=${cbsMs}ms/${cbsCalls} ` +
          `other=${otherMs}ms (lua_len=${t.luaCode.length})`,
      );
      // An overrun here is what makes the host drop the interceptor result, so
      // warn (not trace) once a single trigger is on track to blow the budget.
      if (triggerTotal >= (opts.slowTriggerWarnMs ?? SLOW_TRIGGER_WARN_MS)) {
        log.warn(
          `slow trigger[${i}] mode=${mode} elapsed=${triggerTotal}ms ` +
            `factory=${factoryMs}ms serde=${serdeMs}ms runLua=${runLuaMs}ms ` +
            `api=${apiMs}ms/${apiCalls}calls lua_only=${runLuaMs - apiMs}ms ` +
            `cbs=${cbsMs}ms/${cbsCalls}calls other=${otherMs}ms ` +
            `lua_len=${t.luaCode.length} top=[${probe.topApi(3)}] ` +
            `chatId=${opts.chatId ?? '<none>'}`,
        );
      }
    } catch (err) {
      // Risu scriptings.ts: on throw, keep prior value and continue.
      log.warn(
        `trigger[${i}] mode=${mode} elapsed=${Date.now() - tStart}ms THREW — ${errMsg(err)}; keeping prior value`,
      );
    }
  }

  const chainTotal = Date.now() - chainStart;
  const chainOtherMs =
    chainTotal - preloadMs - totalFactoryMs - totalRunLuaMs - totalSerdeMs;
  log.trace(
    `chain.done mode=${mode} elapsed=${chainTotal}ms eligible=${eligible.length} ` +
      `preload=${preloadMs}ms ` +
      `factory_sum=${totalFactoryMs}ms runLua_sum=${totalRunLuaMs}ms ` +
      `api_sum=${totalApiMs}ms/${totalApiCalls} cbs_sum=${totalCbsMs}ms/${totalCbsCalls} ` +
      `serde_sum=${totalSerdeMs}ms ` +
      `other=${chainOtherMs}ms ` +
      `chatId=${opts.chatId ?? '<none>'}`,
  );
  if (chainTotal >= (opts.slowChainWarnMs ?? SLOW_CHAIN_WARN_MS)) {
    log.warn(
      `slow chain mode=${mode} elapsed=${chainTotal}ms eligible=${eligible.length} ` +
        `preload=${preloadMs}ms factory_sum=${totalFactoryMs}ms ` +
        `runLua_sum=${totalRunLuaMs}ms api_sum=${totalApiMs}ms/${totalApiCalls}calls ` +
        `cbs_sum=${totalCbsMs}ms/${totalCbsCalls}calls serde_sum=${totalSerdeMs}ms ` +
        `other=${chainOtherMs}ms chatId=${opts.chatId ?? '<none>'}`,
    );
  }

  return current;
}
