import { expect, test } from 'bun:test';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';
import type { TriggerEffect } from '../../src/core/schemas/triggerscript.js';

test.each([['v2MakeArrayVar', '[]'], ['v2MakeDictVar', '{}'], ['v2ClearDict', '{}']])(
  '%s terminates the trigger when its destination is a JSON literal', async (type, name) => {
    const { saved } = await runTriggerEffects([
      { type, var: name },
      { type: 'v2SetVar', var: 'after', value: 'ran', valueType: 'value', operator: '=' },
    ] as TriggerEffect[]);
    expect(saved).toEqual({});
  },
);

test('array instructions share ordinary variable storage with string splitting and assignment', async () => {
  const { saved } = await runTriggerEffects([
    { type: 'v2SplitString', source: 'a|b', sourceType: 'value', delimiter: '|', delimiterType: 'value', outputVar: 'list' },
    { type: 'v2PushArrayVar', var: 'list', value: 'c', valueType: 'value' },
    { type: 'v2SliceArrayVar', var: 'list', start: '1', startType: 'value', end: '3', endType: 'value', outputVar: 'slice' },
    { type: 'v2JoinArrayVar', var: 'list', varType: 'var', delimiter: '/', delimiterType: 'value', outputVar: 'joined' },
    { type: 'v2SetVar', var: 'list', operator: '=', value: '[]', valueType: 'value' },
    { type: 'v2GetArrayVarLength', var: 'list', outputVar: 'length' },
  ] as TriggerEffect[]);
  expect(saved).toEqual({ list: '[]', slice: '["b","c"]', joined: 'a/b/c', length: '0' });
});

test('an invalid array resets on push without appending the first item', async () => {
  const { saved } = await runTriggerEffects([
    { type: 'v2PushArrayVar', var: 'list', value: 'first', valueType: 'value' },
    { type: 'v2PushArrayVar', var: 'list', value: 'second', valueType: 'value' },
    { type: 'v2GetArrayVar', var: 'list', index: '5', indexType: 'value', outputVar: 'missing' },
    { type: 'v2PopArrayVar', var: 'list', outputVar: 'last' },
    { type: 'v2PopArrayVar', var: 'list', outputVar: 'empty' },
  ] as TriggerEffect[], { list: '' });
  expect(saved).toEqual({ list: '[]', missing: 'null', last: 'second', empty: 'null' });
});

test('setting an invalid array leaves it unchanged', async () => {
  const { saved } = await runTriggerEffects([
    { type: 'v2SetArrayVar', var: 'list', index: '0', indexType: 'value', value: 'item', valueType: 'value' },
  ] as TriggerEffect[], { list: 'bad JSON' });
  expect(saved).toEqual({ list: 'bad JSON' });
});

test('dictionary reads accept JSON values while writes address variable names', async () => {
  const { saved } = await runTriggerEffects([
    { type: 'v2SetDictVar', var: 'dict', varType: 'var', key: 'added', keyType: 'value', value: 'yes', valueType: 'value' },
    { type: 'v2GetDictVar', var: 'dict', varType: 'var', key: 'added', keyType: 'value', outputVar: 'found' },
    { type: 'v2GetDictVar', var: '{"literal":"ok"}', varType: 'value', key: 'literal', keyType: 'value', outputVar: 'literal' },
    { type: 'v2DeleteDictKey', var: 'dict', varType: 'var', key: 'old', keyType: 'value' },
    { type: 'v2GetDictKeys', var: 'dict', varType: 'var', outputVar: 'keys' },
    { type: 'v2GetDictVar', var: 'dict', varType: 'var', key: 'old', keyType: 'value', outputVar: 'missing' },
  ] as TriggerEffect[], { dict: '{"old":"value"}' });
  expect(saved).toEqual({ dict: '{"added":"yes"}', found: 'yes', literal: 'ok', keys: '["added"]', missing: 'null' });
});
