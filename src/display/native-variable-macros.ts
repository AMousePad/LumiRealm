import type { DisplaySnapshot } from './snapshot.js';
import type { EvaluatorCtx } from '../interpreter/evaluator/types.js';

const VARIABLE_MACRO = /^(get|set|add|inc|dec|has|delete|flush)(var|gvar|globalvar|chatvar)$/;

export interface NativePresetVariables {
  local?: Record<string, string>;
  global?: Record<string, string>;
  chat?: Record<string, string>;
  prompt_selections?: Record<string, string[]>;
  prompt_defaults?: Record<string, string | number>;
}

function ownValue<T>(values: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

function variableScope(initial: Readonly<Record<string, string | null>> | undefined) {
  let changes: Map<string, string | null | undefined> | undefined;
  const get = (key: string) => changes?.has(key) ? changes.get(key) : ownValue(initial, key);
  return {
    get,
    has: (key: string) => changes?.has(key)
      ? changes.get(key) !== undefined
      : initial !== undefined && Object.hasOwn(initial, key),
    set(key: string, value: string) { (changes ??= new Map()).set(key, value); },
    // A deletion must hide the captured value without changing the snapshot.
    delete(key: string) { (changes ??= new Map()).set(key, undefined); },
  };
}

// Lumiverse builds fresh local variables per display invocation. Its global and
// chat writes affect that invocation's environment, not the persisted snapshot.
export function createNativeVariableMacros(
  vars: DisplaySnapshot['vars'],
  touched: Set<string>,
  preset?: NativePresetVariables,
): NonNullable<EvaluatorCtx['resolveLeaf']> {
  const scopes = {
    local: variableScope(preset?.local),
    global: variableScope(preset?.global ?? vars.global),
    chat: variableScope(preset?.chat ?? vars.local),
  };
  const defaults = preset?.prompt_defaults;
  const selections = preset?.prompt_selections;
  return (name, args) => {
    const normalized = name.trim().toLowerCase();
    if (preset && name.startsWith('.')) return { text: String(scopes.local.get(name.slice(1).trim()) ?? ''), terminal: false };
    if (preset && /^(var|promptvar|presetvar|vardefault|promptvardefault|presetvardefault|haspromptvar|haspresetvar|hasvar)$/.test(normalized)) {
      const key = (args[0] ?? '').trim();
      if (!key) return { text: normalized.startsWith('has') ? 'false' : '', terminal: true };
      if (normalized.startsWith('has')) return { text: String(scopes.local.has(key) || (defaults !== undefined && Object.hasOwn(defaults, key))), terminal: true };
      if (normalized.endsWith('default')) return { text: String(ownValue(defaults, key) ?? ''), terminal: false };
      if ((args[1] ?? '').trim().toLowerCase() === 'ison') {
        const wanted = (args[2] ?? '').split(',').map(value => value.trim()).filter(Boolean);
        const selected = ownValue(selections, key);
        return { text: String(wanted.every(value => selected?.includes(value))), terminal: true };
      }
      return { text: String(scopes.local.get(key) ?? ownValue(defaults, key) ?? ''), terminal: false };
    }
    const alias = normalized === 'varexists' ? 'hasvar' : normalized === 'gvarexists' ? 'hasgvar' : normalized;
    const match = VARIABLE_MACRO.exec(alias);
    if (!match) return undefined;
    const operation = match[1]!;
    const scope = match[2] === 'var' ? 'local' : match[2] === 'chatvar' ? 'chat' : 'global';
    const values = scopes[scope];
    const key = (args[0] ?? '').trim();
    if (operation !== 'set' && operation !== 'delete' && operation !== 'flush') {
      if (scope === 'global') touched.add(`global:${key}`);
      if (scope === 'chat') {
        // The extension snapshot exposes persisted chat variables as local.
        touched.add(`local:${key}`);
        touched.add(`chat:${key}`);
      }
    }
    let text: string;
    switch (operation) {
      case 'get': return { text: key && values.has(key) ? String(values.get(key)) : '', terminal: false };
      case 'has': text = String(values.has(key)); break;
      case 'set': values.set(key, args[1] ?? ''); text = ''; break;
      case 'delete': case 'flush': values.delete(key); text = ''; break;
      default: {
        const current = operation === 'add'
          ? parseFloat(values.get(key) ?? '') || 0
          : parseInt(values.get(key) ?? '', 10) || 0;
        const delta = operation === 'add' ? parseFloat(args[1] ?? '') || 0 : operation === 'inc' ? 1 : -1;
        text = String(current + delta);
        values.set(key, text);
      }
    }
    return { text, terminal: true };
  };
}
