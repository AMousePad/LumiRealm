import { describe, expect, spyOn, test } from 'bun:test';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';
import type { TriggerEffect } from '../../src/core/schemas/triggerscript.js';

const fields = {
  var: 'list', varType: 'var', outputVar: 'slot{{getvar::index}}', indent: 0,
  source: 'Abc', sourceType: 'value', index: '0', indexType: 'value',
  value: 'b', valueType: 'value', start: '0', startType: 'value', end: '1', endType: 'value',
  source1: 'a', source1Type: 'value', source2: 'b', source2Type: 'value',
  delimiter: ',', delimiterType: 'value', key: 'key', keyType: 'value',
  regex: 'b', regexType: 'value', flags: '', flagsType: 'value',
  result: '$0', resultType: 'value', replacement: 'B', replacementType: 'value',
  min: '2', minType: 'value', max: '2', maxType: 'value',
};

for (const execution of ['interpreted', 'compiled'] as const) {
  describe(`Risu runTrigger result destinations (${execution})`, () => {
    test('invalid extraction skips the result template random draw', async () => {
      const random = spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        await expect(runTriggerEffects([{
          ...fields, type: 'v2ExtractRegex', value: '{{random::a::b}}', regex: '[', result: '{{random::x::y}}',
        }], {}, {}, [], execution)).rejects.toBeInstanceOf(SyntaxError);
        expect(random).toHaveBeenCalledTimes(1);
      } finally { random.mockRestore(); }
    });
    for (const [type, result] of Object.entries({
      v2GetCharAt: 'A', v2GetCharCount: '3', v2ToLowerCase: 'abc', v2ToUpperCase: 'ABC',
      v2SetCharAt: 'bbc', v2SplitString: '["Abc"]', v2ConcatString: 'ab', v2Random: '2',
      v2ExtractRegex: 'b', v2RegexTest: '1', v2ReplaceString: 'ABc',
      v2GetArrayVarLength: '2', v2GetArrayVar: 'a', v2PopArrayVar: 'b', v2ShiftArrayVar: 'a',
      v2SliceArrayVar: '["a"]', v2JoinArrayVar: 'a,b', v2GetIndexOfValueInArrayVar: '1',
      v2GetMessageCount: '0', v2GetLastMessage: 'null', v2GetLastUserMessage: 'null',
      v2GetLastCharMessage: 'null', v2GetMessageAtIndex: 'null',
      v2GetLorebookCount: '0', v2GetAllLorebooks: '[]', v2GetLorebookCountNew: '0',
    })) {
      test(`${type} expands the destination`, async () => {
        const { saved } = await runTriggerEffects([{ ...fields, type }], { index: '2', list: '["a","b"]' }, {}, [], execution);
        expect(saved.slot2).toBe(result);
        expect(saved).not.toHaveProperty(fields.outputVar);
      });
    }

    for (const [type, result] of Object.entries({
      v2GetDictVar: 'v', v2HasDictKey: '1', v2GetDictSize: '1',
      v2GetDictKeys: '["key"]', v2GetDictValues: '["v"]',
    })) {
      test(`${type} expands the destination`, async () => {
        const { saved } = await runTriggerEffects([{ ...fields, type }], { index: '2', list: '{"key":"v"}' }, {}, [], execution);
        expect(saved.slot2).toBe(result);
      });
    }

    for (const type of ['v2PopArrayVar', 'v2ShiftArrayVar']) {
      test(`${type} saves the remaining array after an aliased output`, async () => {
        const { saved } = await runTriggerEffects([{ type, var: 'list', outputVar: '{{getvar::target}}', indent: 0 }],
          { list: '["a","b"]', target: 'list' }, {}, [], execution);
        expect(saved.list).toBe(type === 'v2PopArrayVar' ? '["a"]' : '["b"]');
      });
      test(`${type} resets invalid storage before expanding its fallback destination`, async () => {
        const { saved } = await runTriggerEffects([{ type, var: 'list', outputVar: '{{getvar::list}}', indent: 0 }],
          { list: 'bad JSON' }, {}, [], execution);
        expect(saved.list).toBe('[]');
        expect(saved['[]']).toBe('null');
        expect(saved).not.toHaveProperty('bad JSON');
      });
    }

    test('V1 regex extraction keeps its literal destination', async () => {
      const effect: TriggerEffect = { type: 'extractRegex', value: 'abc', regex: '(b)', flags: '', result: '$1', inputVar: fields.outputVar };
      const { saved } = await runTriggerEffects([effect], { index: '2' }, { lowLevelAccess: true }, [], execution);
      expect(saved[fields.outputVar]).toBe('b');
      expect(saved).not.toHaveProperty('slot2');
    });
  });
}
