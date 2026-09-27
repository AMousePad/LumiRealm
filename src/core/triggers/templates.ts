import type { TriggerScript } from '../schemas/triggerscript.js';

export function hasTriggerTemplate(value: string): boolean {
  return /\{[{#]|<(?:user|char|bot)>/i.test(value);
}

export function triggerNeedsTemplates(trigger: TriggerScript): boolean {
  const first = trigger.effect[0]?.type;
  if (first === 'triggerlua' || first === 'triggercode') return false;
  // Variable entry conditions also parse the stored value, which is not known
  // until execution. Other operands parse their literal field before lookup.
  if (trigger.conditions.some(condition => condition.type === 'var')) return true;
  return [...trigger.conditions, ...trigger.effect].some(entry =>
    Object.values(entry).some(value => typeof value === 'string' && hasTriggerTemplate(value)),
  );
}
