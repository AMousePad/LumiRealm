import { describe, expect, spyOn, test } from 'bun:test';
import type { TriggerEffect } from '../../src/core/schemas/triggerscript.js';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';

const set = (name: string, value: string, kind = 'value', indent = 0): TriggerEffect => ({
  type: 'v2SetVar', var: name, value, valueType: kind, operator: '=', indent,
} as TriggerEffect);

for (const execution of ['interpreted', 'compiled'] as const) describe(`trigger templates (${execution})`, () => {
  test('dynamic variable names read earlier saved writes and defaults', async () => {
    const { saved } = await runTriggerEffects([
      set('i', '2'), set('unit{{getvar::i}}_hp', '{{getvar::hp}}'),
      set('copy', 'unit{{getvar::i}}_hp', 'var'),
      { type: 'setvar', var: 'legacy{{getvar::i}}', value: '{{getvar::copy}}', operator: '=' },
    ], {}, { preloaded: { scriptstateDefaults: { hp: '1500' } } }, [], execution);
    expect(saved).toEqual({ i: '2', unit2_hp: '1500', copy: '1500', legacy2: '1500' });
  });

  test('CBS reads saved state while direct variable operands see locals', async () => {
    const { saved } = await runTriggerEffects([
      { type: 'v2DeclareLocalVar', var: 'n', value: 'local', valueType: 'value', indent: 0 },
      set('direct', 'n', 'var'), set('macro', '{{getvar::n}}'),
      { type: 'v2DeclareLocalVar', var: 'slot{{getvar::n}}', value: 'named', valueType: 'value', indent: 0 },
      set('copy', 'slotsaved', 'var'),
    ], { n: 'saved' }, {}, [], execution);
    expect(saved).toEqual({ n: 'saved', direct: 'local', macro: 'saved', copy: 'named' });
  });

  test('each operand gets fresh temporary variables and functions', async () => {
    const { saved } = await runTriggerEffects([
      set('dest{{tempvar::slot}}', '{{settempvar::slot::wrong}}value'),
      set('function', '{{#function inner}}yes{{/function}}{{call::inner}}'),
      set('fresh', '{{call::inner}}'),
      set('literal', '{{setvar::mustNotWrite::1}}'),
    ], {}, {}, [], execution);
    expect(saved).toEqual({ dest: 'value', function: 'yes', fresh: '{{call::inner}}', literal: '{{setvar::mustNotWrite::1}}' });
  });

  test('display macros cannot read transient trigger writes as saved variables', async () => {
    const { runtime, saved } = await runTriggerEffects([
      set('temporary', 'visible'), set('direct', 'temporary', 'var'), set('macro', '{{getvar::temporary}}'),
    ], {}, { displayMode: true }, [], execution);
    expect(runtime.getVar('direct')).toBe('visible');
    expect(runtime.getVar('macro')).toBe('null');
    expect(saved).toEqual({});
  });

  test('entry conditions resolve saved templates without treating the key as a template', async () => {
    const { saved } = await runTriggerEffects([set('passed', '1')], {
      literal: '{{getvar::expected}}', expected: 'yes',
    }, {}, [{ type: 'var', var: 'literal', value: '{{getvar::expected}}', operator: '=' }], execution);
    expect(saved.passed).toBe('1');
  });

  test('missing operand type uses a variable reference', async () => {
    const { saved } = await runTriggerEffects([
      { type: 'v2SetVar', var: 'copy', value: 'source', operator: '=', indent: 0 } as TriggerEffect,
    ], { source: 'saved' }, {}, [], execution);
    expect(saved.copy).toBe('saved');
  });

  test('assignment evaluates the value before its destination', async () => {
    const random = spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    try {
      const { saved } = await runTriggerEffects([
        set('slot{{randint::1::2}}', '{{randint::3::4}}'),
      ], {}, {}, [], execution);
      expect(saved).toEqual({ slot2: '3' });
      expect(random).toHaveBeenCalledTimes(2);
    } finally { random.mockRestore(); }
  });

  test('operands use the plain parser context rather than display formatting', async () => {
    const { saved } = await runTriggerEffects([
      set('identity', '<char>/<user>'),
      set('context', '{{role}}/{{isfirstmsg}}/{{asset::portrait}}'),
      set('legacy', '{#if 1\nlegacy block#}'),
    ], {}, {}, [], execution);
    expect(saved).toEqual({ identity: 'Character/User', context: 'null/0/{{asset::portrait}}', legacy: 'legacy block' });
  });
});
