// Risu chatVar.svelte.ts, triggers.ts,2812.
// Chat-scope vars + indented local scopes.

import { toStr } from '../../util/coerce.js';
import { getScriptstateDefaultsByCharacter } from '../defaults-cache.js';
import { makeSafeLogger } from '../../util/safe-log.js';

const _log = makeSafeLogger('runtime.setVar');

export interface VarsState {
  // Keys are $-prefixed; loadVars/saveVars strip on persist.
  readonly varsCache: Record<string, string>;
  readonly scriptstateDefaults?: Readonly<Record<string, string>>;
  readonly tempVars?: Record<string, string>;
  // indent -> name -> value; deepest indent wins over varsCache.
  readonly localScopes: Map<number, Map<string, string>>;
  // Boxed so reference is shared across module boundaries.
  readonly dirty: { value: boolean };
  readonly characterId: string | null;
}

export interface VarsApi {
  getVar(name: string): string;
  setVar(name: string, value: unknown): void;
  resolve(value: unknown, kind: string): string;
  declareLocalVar(name: string, value: unknown, indent: unknown): void;
  setvarV1(name: string, op: string, rawValue: unknown): void;
  setvarV2(name: string, op: string, value: unknown): void;
  getLocal(name: string): string | undefined;
}

export function makeVarsApi(state: VarsState): VarsApi {
  function getLocal(name: string): string | undefined {
    const scopes = [...state.localScopes.values()].reverse();
    for (const scope of scopes) {
      if (scope.has(name)) return scope.get(name);
    }
    return undefined;
  }

  function getVar(name: string): string {
    const n = toStr(name);
    const local = getLocal(n);
    if (local !== undefined) return toStr(local);
    const fromCache = state.varsCache['$' + n];
    if (fromCache !== undefined) return toStr(fromCache);
    // Risu chatVar.svelte.ts: consult defaultVariables before returning 'null'.
    const defaults = state.scriptstateDefaults
      ?? getScriptstateDefaultsByCharacter(state.characterId);
    const fromDefaults = defaults?.[n];
    if (fromDefaults !== undefined) return toStr(fromDefaults);
    const fromTemp = state.tempVars?.[n];
    if (fromTemp !== undefined) return toStr(fromTemp);
    return 'null';
  }

  function setVar(name: string, value: unknown): void {
    const n = toStr(name);
    const v = toStr(value);
    if (state.tempVars) {
      state.tempVars[n] = v;
      return;
    }
    state.varsCache['$' + n] = v;
    state.dirty.value = true;
    _log.info(`$${n}=${JSON.stringify(v.slice(0, 80))}`);
  }

  function resolve(value: unknown, kind: string): string {
    if (kind === 'value' || kind === 'regex') return toStr(value);
    if (kind === 'var') return getVar(toStr(value));
    return toStr(value);
  }

  function declareLocalVar(name: string, value: unknown, indent: unknown): void {
    const n = Number(indent) || 0;
    if (!state.localScopes.has(n)) state.localScopes.set(n, new Map());
    state.localScopes.get(n)!.set(toStr(name), toStr(value));
  }

  function setvarV1(name: string, op: string, rawValue: unknown): void {
    const rendered = toStr(resolve(rawValue, 'value'));
    if (op === '=' || !op) { setVar(name, rendered); return; }
    const pN = Number(getVar(name));
    const pBase = Number.isFinite(pN) ? pN : 0;
    const nN = Number(rendered);
    const nBase = Number.isFinite(nN) ? nN : 0;
    let result: number | string;
    switch (op) {
      case '+=': result = pBase + nBase; break;
      case '-=': result = pBase - nBase; break;
      case '*=': result = pBase * nBase; break;
      case '/=': result = nBase === 0 ? 0 : pBase / nBase; break;
      default: result = rendered; break;
    }
    setVar(name, String(result));
  }

  function setvarV2(name: string, op: string, value: unknown): void {
    const prev = getVar(name);
    const valueStr = toStr(value);
    let result: string;
    if (op === '=') result = valueStr;
    else if (op === '+=') {
      const nP = Number(prev), nV = Number(valueStr);
      if (Number.isFinite(nP) && Number.isFinite(nV)) result = String(nP + nV);
      else result = toStr(prev) + valueStr;
    }
    else if (op === '-=') result = String(Number(prev) - Number(valueStr));
    else if (op === '*=') result = String(Number(prev) * Number(valueStr));
    else if (op === '/=') result = Number(valueStr) === 0 ? '0' : String(Number(prev) / Number(valueStr));
    else if (op === '%=') result = Number(valueStr) === 0 ? '0' : String(Number(prev) % Number(valueStr));
    else result = valueStr;
    setVar(name, result);
  }

  return {
    getVar, setVar, resolve, declareLocalVar, setvarV1, setvarV2, getLocal,
  };
}
