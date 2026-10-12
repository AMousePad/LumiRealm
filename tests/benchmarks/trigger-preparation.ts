import { prepareTriggerSources } from '../../src/interpreter/dispatcher.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';

const triggers: TriggerScript[] = Array.from({ length: 100 }, (_, index) => ({
  type: 'manual', comment: `sample-${index}`, conditions: [],
  effect: Array.from({ length: 20 }, (_, value) => ({
    type: 'setvar', var: `value${value}`, operator: '=', value: String(value),
  })),
}));
for (let i = 0; i < 100; i++) prepareTriggerSources(triggers, 'synthetic-character');
const rounds = Array.from({ length: 7 }, () => {
  const start = performance.now();
  for (let i = 0; i < 200; i++) prepareTriggerSources(triggers, 'synthetic-character');
  return (performance.now() - start) / 200;
}).sort((a, b) => a - b);
console.log(JSON.stringify({
  triggers: 100, effectsPerTrigger: 20, medianMs: rounds[3],
  serializedBytes: new TextEncoder().encode(JSON.stringify(prepareTriggerSources(triggers, 'synthetic-character'))).length,
}));
