/**
 * Dispatcher type-bypass for triggerlua / triggercode (Risu parity).
 *
 * Risu's `runTrigger` skips the type-vs-mode filter for triggerlua and
 * triggercode first effects: the same Lua body runs on every binding, and
 * the runtime picks the entry function (`onStart`, `onOutput`, etc) by
 * binding alone. Without this bypass, a `start`-typed trigger whose Lua
 * defines `onOutput` never fires when dispatched on the output binding,
 * pin this behavior via `triggerMatchesBinding`.
 */

import { describe, test, expect } from 'bun:test';
import {
  triggerMatchesBinding,
  type CompiledTriggerEntry,
} from '../../src/interpreter/dispatcher.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import type { RisuBinding } from '../../src/interpreter/runtime.js';

function entry(spec: {
  name?: string;
  type?: 'trigger' | 'library';
  binding?: RisuBinding;
  firstEffectType?: string;
}): CompiledTriggerEntry {
  const firstEffect = spec.firstEffectType
    ? { type: spec.firstEffectType }
    : null;
  const binding = spec.binding ?? 'start';
  return {
    name: spec.name ?? 'test',
    code: '',
    type: spec.type ?? 'trigger',
    triggers: [],
    binding,
    source: {
      type: 'manual',
      conditions: [],
      effect: firstEffect ? [firstEffect] : [],
    } as unknown as TriggerScript,
    rtOpts: { displayMode: false, lowLevelAccess: false, binding, characterId: 'test' },
  };
}

describe('triggerMatchesBinding: V2 effect-block strict-type filter', () => {
  test('binding match → true', () => {
    const t = entry({ binding: 'start', firstEffectType: 'v2SetVar' });
    expect(triggerMatchesBinding(t, 'start')).toBe(true);
  });

  test('binding mismatch → false (V2 effects)', () => {
    const t = entry({ binding: 'start', firstEffectType: 'v2SetVar' });
    expect(triggerMatchesBinding(t, 'output')).toBe(false);
    expect(triggerMatchesBinding(t, 'request')).toBe(false);
    expect(triggerMatchesBinding(t, 'display')).toBe(false);
    expect(triggerMatchesBinding(t, 'manual')).toBe(false);
  });

  test('all V2 effect-block types are subject to strict filter (sample of opcodes)', () => {
    const v2Effects = [
      'v2SetVar',
      'v2DeclareLocalVar',
      'v2RunTrigger',
      'v2RunLLM',
      'v2If',
      'v2Loop',
      'v2GetDisplayState',
    ];
    for (const e of v2Effects) {
      const t = entry({ binding: 'start', firstEffectType: e });
      expect(triggerMatchesBinding(t, 'start')).toBe(true);
      expect(triggerMatchesBinding(t, 'output')).toBe(false);
    }
  });
});

describe('triggerMatchesBinding: triggerlua/triggercode type-bypass (Risu parity)', () => {
  test('triggerlua first effect: matches EVERY binding regardless of declared type', () => {
    const startLua = entry({ binding: 'start', firstEffectType: 'triggerlua' });
    expect(triggerMatchesBinding(startLua, 'start')).toBe(true);
    expect(triggerMatchesBinding(startLua, 'request')).toBe(true);
    expect(triggerMatchesBinding(startLua, 'output')).toBe(true);
    expect(triggerMatchesBinding(startLua, 'display')).toBe(true);
    expect(triggerMatchesBinding(startLua, 'manual')).toBe(true);
  });

  test('triggercode first effect: same bypass as triggerlua', () => {
    const startCode = entry({ binding: 'start', firstEffectType: 'triggercode' });
    expect(triggerMatchesBinding(startCode, 'start')).toBe(true);
    expect(triggerMatchesBinding(startCode, 'output')).toBe(true);
    expect(triggerMatchesBinding(startCode, 'display')).toBe(true);
  });

  test('start-declared lua trigger with onOutput fires on GENERATION_ENDED (output)', () => {
    // Canonical case: a start-typed trigger whose Lua defines `onOutput`
    // for phase parsing. Pre-fix the strict filter rejected it on output
    // binding, post-fix the type-bypass admits it and the runtime picks
    // the `onOutput` entry function based on dispatch binding.
    const startTypedOnOutputTrigger = entry({
      name: 'start-onoutput-main',
      binding: 'start',
      firstEffectType: 'triggerlua',
    });
    expect(triggerMatchesBinding(startTypedOnOutputTrigger, 'output')).toBe(true);
    // Sanity: same trigger also fires on its declared binding.
    expect(triggerMatchesBinding(startTypedOnOutputTrigger, 'start')).toBe(true);
  });
});

describe('triggerMatchesBinding: non-trigger types never match', () => {
  test('library entries (manual-trigger globals) never fire on dispatchBinding', () => {
    // `library` entries are invoked by name via `dispatchManualTrigger`,
    // NOT by binding-broadcast. They should never appear in a binding
    // sweep regardless of what's in source.effect[0].
    const lib = entry({ type: 'library', firstEffectType: 'triggerlua' });
    expect(triggerMatchesBinding(lib, 'start')).toBe(false);
    expect(triggerMatchesBinding(lib, 'output')).toBe(false);
    expect(triggerMatchesBinding(lib, 'manual')).toBe(false);
  });
});

describe('triggerMatchesBinding: edge cases / hostile inputs', () => {
  test('empty effect array (no first effect): falls through to strict-type filter', () => {
    const t = entry({ binding: 'start' }); // firstEffectType omitted → effect: []
    expect(triggerMatchesBinding(t, 'start')).toBe(true);
    expect(triggerMatchesBinding(t, 'output')).toBe(false);
  });

  test('first effect with unknown type string: treated as non-lua → strict filter', () => {
    const t = entry({ binding: 'output', firstEffectType: 'someUnrecognizedOp' });
    expect(triggerMatchesBinding(t, 'output')).toBe(true);
    expect(triggerMatchesBinding(t, 'start')).toBe(false);
  });

  test('source.effect missing entirely (defensive): falls through to strict filter without crash', () => {
    const t: CompiledTriggerEntry = {
      name: 't',
      code: '',
      type: 'trigger',
      triggers: [],
      binding: 'start',
      source: { type: 'manual', conditions: [] } as unknown as TriggerScript,
      rtOpts: { displayMode: false, lowLevelAccess: false, binding: 'start', characterId: 'test' },
    };
    expect(triggerMatchesBinding(t, 'start')).toBe(true);
    expect(triggerMatchesBinding(t, 'output')).toBe(false);
  });
});
