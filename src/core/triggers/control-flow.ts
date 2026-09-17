import type { TriggerEffect } from '../schemas/triggerscript.js';

export const CONTROL_OPS = new Set([
  'v2If', 'v2IfAdvanced', 'v2Else', 'v2EndIndent', 'v2Loop', 'v2LoopNTimes', 'v2BreakLoop',
]);

export interface TriggerControlState {
  readonly loops: Record<number, number>;
  ticks: number;
}

export interface TriggerControlRuntime {
  resolve(value: unknown, kind: string): string;
  compare(a: unknown, b: unknown, op: string): boolean;
  setIndent(indent: unknown): void;
  clearLocalVars(indent: number): void;
  sleep(ms: number): Promise<void>;
}

// Risu runTrigger executes boundary markers themselves; skipped markers neither
// clear local variables nor advance counters, including markers skipped by break.
export async function advanceTriggerControl(
  effects: readonly TriggerEffect[],
  index: number,
  state: TriggerControlState,
  rt: TriggerControlRuntime,
): Promise<number | undefined> {
  const effect = effects[index]! as TriggerEffect & { indent: number; condition: string };
  rt.setIndent('indent' in effect ? effect.indent : 0);
  switch (effect.type) {
    case 'v2If':
    case 'v2IfAdvanced': {
      const source = rt.resolve(effect.source, effect.type === 'v2If' || effect.sourceType === 'var' ? 'var' : 'value');
      const target = rt.resolve(effect.target, effect.targetType === 'value' ? 'value' : 'var');
      if (!rt.compare(source, target, effect.condition)) {
        for (; index < effects.length; index++) {
          const end = effects[index]!;
          if (end.type === 'v2EndIndent' && end.indent === effect.indent + 1) {
            const next = effects[index + 1];
            if (next?.type === 'v2Else' && next.indent === effect.indent) index++;
            break;
          }
        }
      }
      return index;
    }
    case 'v2Else':
      for (; index < effects.length; index++) {
        const end = effects[index]!;
        if (end.type === 'v2EndIndent' && end.indent === effect.indent + 1) break;
      }
      return index;
    case 'v2EndIndent':
      if (effect.endOfLoop) {
        const endIndex = index;
        for (; index >= 0; index--) {
          const start = effects[index]!;
          if ((start.type === 'v2Loop' || start.type === 'v2LoopNTimes') && start.indent === effect.indent - 1) {
            if (start.type === 'v2LoopNTimes') {
              const count = Number(rt.resolve(start.value, start.valueType === 'value' ? 'value' : 'var'));
              state.loops[index] = (state.loops[index] ?? 0) + 1;
              if (state.loops[index]! >= (Number.isNaN(count) ? 0 : count)) index = endIndex;
            }
            break;
          }
        }
        if (++state.ticks > 100) { await rt.sleep(1); state.ticks = 0; }
      }
      rt.clearLocalVars(effect.indent);
      return index;
    case 'v2BreakLoop':
      for (; index < effects.length; index++) {
        const end = effects[index]!;
        if (end.type === 'v2EndIndent' && end.endOfLoop) break;
      }
      return index;
    case 'v2Loop':
    case 'v2LoopNTimes':
      return index;
    default:
      return undefined;
  }
}
