// Risu triggers.ts.

import { toStr } from '../../util/coerce.js';

export function compareValues(a: unknown, b: unknown, op: string): boolean {
  const as = toStr(a);
  const bs = toStr(b);
  switch (op) {
    case '=':
      return !Number.isNaN(Number(as)) && !Number.isNaN(Number(bs)) ? Number(as) === Number(bs) : as === bs;
    case '!=':
      return !Number.isNaN(Number(as)) && !Number.isNaN(Number(bs)) ? Number(as) !== Number(bs) : as !== bs;
    case '>':
      return Number(a) > Number(b);
    case '<':
      return Number(a) < Number(b);
    case '>=':
      return Number(a) >= Number(b);
    case '<=':
      return Number(a) <= Number(b);
    case '∋':
      try { return (JSON.parse(as) as unknown[]).includes(bs); } catch { return false; }
    case '∌':
      try { return !(JSON.parse(as) as unknown[]).includes(bs); } catch { return true; }
    case '∈':
      try { return (JSON.parse(bs) as unknown[]).includes(as); } catch { return false; }
    case '∉':
      try { return !(JSON.parse(bs) as unknown[]).includes(as); } catch { return true; }
    case '≒': {
      const n1 = Number(as), n2 = Number(bs);
      if (Number.isNaN(n1) || Number.isNaN(n2)) return as.toLocaleLowerCase().replace(/ /g, '') === bs.toLocaleLowerCase().replace(/ /g, '');
      return Math.abs(n1 - n2) < 0.0001;
    }
    case '≡':
      if (bs === 'true') return as === 'true' || as === '1';
      if (bs === 'false') return !(as === 'true' || as === '1');
      return as === bs;
    default: return false;
  }
}

// Trigger-level conditions use strict strings and negated numeric comparisons in Risu.
export function compareTriggerCondition(source: string, target: string, operator: string): boolean {
  switch (operator) {
    case 'true': return source === 'true' || source === '1';
    case '=': return source === target;
    case '!=': return source !== target;
    case '>': return !(Number(source) <= Number(target));
    case '<': return !(Number(source) >= Number(target));
    case '>=': return !(Number(source) < Number(target));
    case '<=': return !(Number(source) > Number(target));
    case 'null': return source === 'null';
    default: return true;
  }
}
