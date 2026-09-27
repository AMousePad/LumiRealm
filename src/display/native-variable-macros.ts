import type { DisplaySnapshot } from './snapshot.js';
import type { EvaluatorCtx } from '../interpreter/evaluator/types.js';

const VARIABLE_MACRO = /^(get|set|add|inc|dec|has|delete|flush)(var|gvar|globalvar|chatvar)$/;

// Lumiverse builds fresh local variables per display invocation. Its global and
// chat writes affect that invocation's environment, not the persisted snapshot.
export function createNativeVariableMacros(
  vars: DisplaySnapshot['vars'],
  touched: Set<string>,
): NonNullable<EvaluatorCtx['resolveLeaf']> {
  const scopes = {
    local: new Map<string, string>(),
    global: new Map(Object.entries(vars.global)),
    chat: new Map(Object.entries(vars.local)),
  };
  return (name, args) => {
    const normalized = name.trim().toLowerCase();
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
