// Risu chatVar.svelte.ts, triggers.ts,2812.
// Chat-scope vars + indented local scopes.

import { toStr } from '../../util/coerce.js';
import { getScriptstateDefaultsByCharacter } from '../defaults-cache.js';
import { makeSafeLogger } from '../../util/safe-log.js';

const _log = makeSafeLogger('runtime.setVar');

export interface VarsState {
  // Keys are $-prefixed; loadVars/saveVars strip on persist.
  readonly varsCache: Record<string, string | null>;
  readonly scriptstateDefaults?: Readonly<Record<string, string>>;
  readonly tempVars?: Record<string, string>;
  // indent -> name -> value; deepest indent wins over varsCache.
  readonly localScopes: Map<string, Map<string, string>>;
  readonly currentIndent?: { value: number };
  // Boxed so reference is shared across module boundaries.
  readonly dirty: { value: boolean };
  readonly storedVars?: () => Readonly<Record<string, string | null>>;
  readonly onStoredWrite?: () => void;
  readonly characterId: string | null;
  // FE display dep recording: Lua var reads are invisible to the CBS recorder.
  readonly onVarRead?: (name: string) => void;
  readonly parseTemplate?: (text: string) => string;
}

export interface VarsApi {
  getVar(name: string): string;
  getStoredVar(name: string): string;
  setVar(name: string, value: unknown): void;
  resolve(value: unknown, kind: string): string;
  declareLocalVar(name: string, value: unknown, indent: unknown): void;
  setvarV1(name: string, op: string, rawValue: unknown): void;
  setvarV2(name: string, op: string, value: unknown): void;
  getLocal(name: string): string | undefined;
  setIndent(indent: unknown): void;
  clearLocalVars(indent: number): void;
}

export type TriggerLocalState = Required<Pick<VarsState, 'localScopes' | 'currentIndent'>>;

export function createTriggerLocalState(): TriggerLocalState {
  return { localScopes: new Map(), currentIndent: { value: 0 } };
}

export function makeVarsApi(state: VarsState): VarsApi {
  const currentIndent = state.currentIndent ?? { value: 0 };
  function setIndent(indent: unknown): void {
    if (typeof indent === 'number' && indent >= 0) currentIndent.value = indent;
  }

  function localScope(name: string, indent: unknown): Map<string, string> | undefined {
    for (let i = indent as number; i >= 0; i--) {
      const scope = state.localScopes.get(String(i));
      if (scope?.has(name)) return scope;
    }
    return undefined;
  }

  function getLocal(name: string): string | undefined {
    return localScope(name, currentIndent.value)?.get(name);
  }

  function clearLocalVars(indent: number): void {
    for (const depth of state.localScopes.keys()) {
      if (Number(depth) >= indent) state.localScopes.delete(depth);
    }
  }

  function getVar(name: string): string {
    const n = toStr(name);
    state.onVarRead?.(n);
    const local = getLocal(n);
    if (local !== undefined) return toStr(local);
    return storedVar(n) ?? state.tempVars?.[n] ?? 'null';
  }

  function storedVar(n: string, cache = state.varsCache): string | undefined {
    const fromCache = cache['$' + n];
    if (fromCache != null) return toStr(fromCache);
    // Risu chatVar.svelte.ts: consult defaultVariables before returning 'null'.
    const defaults = state.scriptstateDefaults
      ?? getScriptstateDefaultsByCharacter(state.characterId);
    const fromDefaults = defaults?.[n];
    if (fromDefaults !== undefined) return toStr(fromDefaults);
    return undefined;
  }

  function getStoredVar(name: string): string {
    state.onVarRead?.(name);
    return storedVar(name, state.storedVars?.() ?? state.varsCache) ?? 'null';
  }

  function setVar(name: string, value: unknown): void {
    const n = toStr(name);
    const v = toStr(value);
    if (state.tempVars) {
      state.tempVars[n] = v;
      return;
    }
    const local = localScope(n, currentIndent.value);
    if (local) { local.set(n, v); return; }
    // Risu runTrigger only marks stored state as changed when the value differs.
    if (state.varsCache['$' + n] === v) return;
    state.varsCache['$' + n] = v;
    state.onStoredWrite?.();
    state.dirty.value = true;
    _log.info(`$${n}=${JSON.stringify(v.slice(0, 80))}`);
  }

  function resolve(value: unknown, kind: string): string {
    const text = toStr(value);
    const parsed = state.parseTemplate ? state.parseTemplate(text) : text;
    return kind === 'var' ? getVar(parsed) : parsed;
  }

  function declareLocalVar(name: string, value: unknown, indent: unknown): void {
    const n = String(indent);
    let scope = localScope(toStr(name), indent) ?? state.localScopes.get(n);
    if (!scope) { scope = new Map(); state.localScopes.set(n, scope); }
    scope.set(toStr(name), value == null ? 'null' : toStr(value));
  }

  function setvarV1(name: string, op: string, rawValue: unknown): void {
    const value = resolve(rawValue, 'value');
    assign(resolve(name, 'value'), op, value, false);
  }

  function setvarV2(name: string, op: string, value: unknown): void {
    assign(name, op, value, true);
  }

  function assign(name: string, op: string, value: unknown, allowRemainder: boolean): void {
    const previous = Number(getVar(name));
    const base = Number.isNaN(previous) ? 0 : previous;
    const valueStr = toStr(value);
    const number = Number(valueStr);
    let result: string | number = '';
    switch (op) {
      case '=': result = valueStr; break;
      case '+=': result = base + number; break;
      case '-=': result = base - number; break;
      case '*=': result = base * number; break;
      case '/=': result = base / number; break;
      case '%=': if (allowRemainder) result = base % number; break;
    }
    setVar(name, String(result));
  }

  return {
    getVar, getStoredVar, setVar, resolve, declareLocalVar, setvarV1, setvarV2, getLocal, setIndent, clearLocalVars,
  };
}
