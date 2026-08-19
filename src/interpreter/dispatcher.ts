
import type { TriggerScript } from '../core/schemas/index.js';
import { compileTriggers } from '../core/mappers/index.js';
import type { RisuPayload } from '../core/payload/index.js';
import {
  makeRisuTriggerRuntime,
  makeRisuRegexRuntime,
} from './runtime.js';
import { execute as luaExecute } from './lua-bridge.js';
import type { HostApi, DispatchData, ScriptNS, TriggerRuntimeOpts } from './host.js';
import type { RisuBinding } from './runtime.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { interpretTrigger, type InterpConsole } from './trigger-interpreter.js';
import { withTriggerDepth } from './runtime/als.js';

export interface DispatcherScriptNS extends ScriptNS {
  /** Manual triggers registered by name — v2RunTrigger resolves through here. */
  registerManual(name: string, runner: (ctx: { api: HostApi; data: DispatchData }) => Promise<void>): void;
}

export function makeDispatcherScriptNS(): DispatcherScriptNS {
  const nlog = makeSafeLogger('scriptNS').info;
  const manuals = new Map<string, { run: (ctx: unknown) => Promise<unknown> }>();
  const risuCompat = { makeRisuTriggerRuntime, makeRisuRegexRuntime };
  const risuCompatLua = { execute: luaExecute };
  return {
    async require(name: string): Promise<unknown> {
      if (name === 'risu-compat') { nlog(`require('risu-compat') → OK`); return risuCompat; }
      if (name === 'risu-compat-lua') { nlog(`require('risu-compat-lua') → OK`); return risuCompatLua; }
      if (manuals.has(name)) { nlog(`require('${name}') → manual OK`); return manuals.get(name); }
      const stripped = name.replace(/^risu-manual-/, '');
      if (manuals.has(stripped)) { nlog(`require('${name}') → manual(stripped='${stripped}') OK`); return manuals.get(stripped); }
      nlog(`require('${name}') → NULL (not found; manuals=${JSON.stringify([...manuals.keys()])})`);
      return null;
    },
    registerManual(name: string, runner) {
      manuals.set('risu-manual-' + name, { run: async (ctx) => runner(ctx as { api: HostApi; data: DispatchData }) });
      manuals.set(name, { run: async (ctx) => runner(ctx as { api: HostApi; data: DispatchData }) });
    },
  };
}

export interface TriggerRtOpts {
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly binding: RisuBinding;
  readonly characterId: string;
}

export interface CompiledTriggerEntry {
  readonly name: string;
  readonly code: string;
  readonly type: 'trigger' | 'library';
  readonly triggers: readonly string[];
  readonly binding: RisuBinding;
  readonly source: TriggerScript;
  readonly rtOpts: TriggerRtOpts;
}

export function prepareTriggers(
  payload: RisuPayload,
  characterId: string,
): readonly CompiledTriggerEntry[] {
  const rawTriggers = payload.triggers as readonly TriggerScript[];
  const compiled = compileTriggers(rawTriggers, { characterId });
  const out: CompiledTriggerEntry[] = [];
  for (let i = 0; i < compiled.files.length; i++) {
    const f = compiled.files[i]!;
    const sourceTrigger = rawTriggers[i];
    if (!sourceTrigger) continue;
    const binding = sourceTrigger.type as RisuBinding;
    out.push({
      name: f.name,
      code: f.code,
      type: f.type,
      triggers: f.triggers ?? [],
      binding,
      source: sourceTrigger,
      rtOpts: {
        displayMode: binding === 'display',
        lowLevelAccess: Boolean(sourceTrigger.lowLevelAccess),
        binding,
        characterId,
      },
    });
  }
  return out;
}

export const GENERATION_ENDED_EXTRA: readonly RisuBinding[] = ['display'];

export interface DispatchCtx {
  readonly compiledTriggers: readonly CompiledTriggerEntry[];
  readonly api: HostApi;
  readonly data: DispatchData;
  readonly scriptNS: DispatcherScriptNS;
  readonly opts: TriggerRuntimeOpts;
}

export function triggerMatchesBinding(
  t: CompiledTriggerEntry,
  binding: RisuBinding,
): boolean {
  if (t.type !== 'trigger') return false;
  const firstEffect = t.source?.effect?.[0];
  const isLuaOrCode = firstEffect?.type === 'triggerlua' || firstEffect?.type === 'triggercode';
  if (isLuaOrCode) return true;
  return t.binding === binding;
}

export interface DispatchBindingOutcome {
  /** True when any trigger requested stopSending (Risu stopChat / v1 stop effect). */
  readonly stopSending: boolean;
}

export async function dispatchBinding(
  ctx: DispatchCtx,
  binding: RisuBinding,
  onError?: (err: unknown, triggerName: string) => void,
): Promise<DispatchBindingOutcome> {
  const dlog = makeSafeLogger('dispatcher').info;
  const matches = ctx.compiledTriggers.filter((t) => triggerMatchesBinding(t, binding));
  dlog(`dispatchBinding: binding=${binding} matches=${matches.length}/${ctx.compiledTriggers.length} data=${JSON.stringify(ctx.data).slice(0, 200)}`);
  let stopSending = false;
  for (const entry of matches) {
    const tStart = Date.now();
    dlog(`→ trigger START name=${entry.name} binding=${entry.binding} triggers=${JSON.stringify(entry.triggers)} effects=${entry.source?.effect?.length ?? 0}`);
    // Out-param: a stopChat() issued before a later crash still counts.
    const flags = { stopSending: false };
    try {
      await runInterpretedTrigger(
        entry,
        ctx.api,
        ctx.data,
        ctx.scriptNS,
        { binding, displayMode: binding === 'display' },
        flags,
      );
      dlog(`← trigger DONE name=${entry.name} elapsed=${Date.now() - tStart}ms stopSending=${flags.stopSending}`);
    } catch (err) {
      dlog(`× trigger ERROR name=${entry.name} elapsed=${Date.now() - tStart}ms msg=${(err as Error).message} stopSending=${flags.stopSending}`);
      if (onError) onError(err, entry.name);
      else throw err;
    } finally {
      if (flags.stopSending) stopSending = true;
    }
  }
  return { stopSending };
}

function makeMirroredConsole(name: string): InterpConsole {
  const L = makeSafeLogger(`trigger[${name}]`);
  const fmt = (a: unknown[]): string =>
    a
      .map((x) => {
        try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
      })
      .join(' ')
      .slice(0, 600);
  return {
    log: (...a: unknown[]) => L.info(`console.log: ${fmt(a)}`),
    warn: (...a: unknown[]) => L.info(`console.warn: ${fmt(a)}`),
    error: (...a: unknown[]) => L.error(`console.error: ${fmt(a)}`),
    info: (...a: unknown[]) => L.info(`console.info: ${fmt(a)}`),
  };
}

// Risu's `arg.displayMode`: set by a render pass only, never derived from the
// declared type. Deriving it would make variables ephemeral on manual clicks.
interface TriggerInvocation {
  readonly binding: RisuBinding;
  readonly displayMode: boolean;
}

async function runInterpretedTrigger(
  entry: CompiledTriggerEntry,
  api: HostApi,
  data: DispatchData,
  scriptNS: DispatcherScriptNS,
  invocation: TriggerInvocation,
  outFlags?: { stopSending: boolean },
): Promise<void> {
  await withTriggerDepth(async () => {
    const rLog = makeSafeLogger(`runTrigger[${entry.name}]`);
    const t0 = Date.now();
    const rt = await makeRisuTriggerRuntime(api, data, scriptNS, {
      displayMode: invocation.displayMode,
      lowLevelAccess: entry.rtOpts.lowLevelAccess,
      binding: invocation.binding,
      characterId: entry.rtOpts.characterId,
    });
    try {
      await interpretTrigger(entry.source, rt, makeMirroredConsole(entry.name), {
        displayMode: invocation.displayMode,
        lowLevelAccess: entry.rtOpts.lowLevelAccess,
      });
      rLog.info(`RETURN OK elapsed=${Date.now() - t0}ms`);
    } catch (err) {
      rLog.error(`THREW elapsed=${Date.now() - t0}ms — ${(err as Error).message}\n${(err as Error).stack ?? ''}`);
      throw err;
    } finally {
      if (outFlags && rt.stopSending) outFlags.stopSending = true;
      await rt.flush();
    }
  });
}

export async function dispatchByManualName(
  ctx: DispatchCtx,
  manualName: string,
  onError?: (err: unknown, triggerName: string) => void,
): Promise<number> {
  const dlog = makeSafeLogger('dispatcher').info;
  const matches = ctx.compiledTriggers.filter((t) => {
    const firstEffect = t.source?.effect?.[0];
    const isLuaOrCode = firstEffect?.type === 'triggerlua' || firstEffect?.type === 'triggercode';
    if (isLuaOrCode) return false;
    return t.source?.comment === manualName;
  });
  dlog(`dispatchByManualName: name="${manualName}" matches=${matches.length}/${ctx.compiledTriggers.length}`);
  let fired = 0;
  for (const entry of matches) {
    try {
      await runInterpretedTrigger(
        entry,
        ctx.api,
        ctx.data,
        ctx.scriptNS,
        { binding: 'manual', displayMode: false },
      );
      fired++;
      dlog(`dispatchByManualName: fired entry name=${entry.name} type=${entry.type} binding=${entry.binding}`);
    } catch (err) {
      onError?.(err, entry.name);
    }
  }
  return fired;
}

export function registerManualTriggers(
  scriptNS: DispatcherScriptNS,
  compiled: readonly CompiledTriggerEntry[],
  api: HostApi,
): void {
  for (const entry of compiled) {
    if (entry.type !== 'library') continue;
    scriptNS.registerManual(entry.name, async (ctx) => {
      await runInterpretedTrigger(
        entry,
        ctx.api ?? api,
        ctx.data,
        scriptNS,
        { binding: 'manual', displayMode: false },
      );
    });
  }
}
