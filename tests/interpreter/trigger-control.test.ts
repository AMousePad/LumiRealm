import { describe, expect, test } from 'bun:test';
import type { TriggerEffect, TriggerScript } from '../../src/core/schemas/triggerscript.js';
import type { HostApi } from '../../src/interpreter/host.js';
import type { RisuPayload } from '../../src/core/payload/index.js';
import { dispatchBinding, dispatchByManualName, makeDispatcherScriptNS, prepareTriggers, registerManualTriggers } from '../../src/interpreter/dispatcher.js';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';

const set = (name: string, value: string, indent = 0, valueType = 'value', operator = '='): TriggerEffect =>
  ({ type: 'v2SetVar', var: name, value, valueType, operator, indent });
const local = (name: string, value: string, indent: number): TriggerEffect =>
  ({ type: 'v2DeclareLocalVar', var: name, value, valueType: 'value', indent });
const end = (indent: number, loop = false): TriggerEffect => ({ type: 'v2EndIndent', indent, endOfLoop: loop });
const loop = (value: string, indent = 0, valueType = 'value'): TriggerEffect =>
  ({ type: 'v2LoopNTimes', value, valueType, indent });

for (const execution of ['interpreted', 'compiled'] as const) describe(execution, () => {
  const run = (effects: readonly TriggerEffect[], initial: Record<string, string> = {}) =>
    runTriggerEffects(effects, initial, {}, [], execution);

  test('Risu runTrigger writes to an existing local without saving it as chat state', async () => {
    const result = await run([
      local('count', '2', 0), set('count', '3', 0, 'value', '+='), set('copied', 'count', 0, 'var'),
    ], { count: '10' });
    expect(result.saved).toEqual({ count: '10', copied: '5' });
  });

  test('nested declarations update the nearest binding and end markers clear the exited scope', async () => {
    const result = await run([
      local('outer', '1', 0), local('outer', '2', 1), local('inner', '3', 1), end(1),
      set('a', 'outer', 0, 'var'), set('b', 'inner', 0, 'var'), end(0), set('c', 'outer', 0, 'var'),
    ]);
    expect(result.saved).toEqual({ a: '2', b: 'null', c: 'null' });
  });

  test('local reads follow the current instruction depth rather than insertion order', async () => {
    const result = await run([
      local('value', 'deep', 2), set('a', 'value', 0, 'var'), set('b', 'value', 2, 'var'),
      end(2), set('c', 'value', 2, 'var'),
    ], { value: 'saved' });
    expect(result.saved).toEqual({ value: 'saved', a: 'saved', b: 'deep', c: 'saved' });
  });

  test.each([['0', '1'], ['-3', '1'], ['bad', '1'], ['1.1', '2'], ['3', '3']])(
    'Risu counted loop %s executes its body %s times', async (count, expected) => {
      const result = await run([loop(count), set('count', '1', 1, 'value', '+='), end(1, true)], { count: '0' });
      expect(result.saved.count).toBe(expected);
    },
  );

  test('loop limits are read at the end of each iteration', async () => {
    const result = await run([
      loop('limit', 0, 'var'), set('count', '1', 1, 'value', '+='), set('limit', '1', 1), end(1, true),
    ], { count: '0', limit: '3' });
    expect(result.saved).toEqual({ count: '1', limit: '1' });
  });

  test('nested counted loops retain their instruction counters during reentry', async () => {
    const result = await run([
      loop('2'), loop('2', 1), set('count', '1', 2, 'value', '+='), end(2, true), end(1, true),
    ], { count: '0' });
    expect(result.saved.count).toBe('3');
  });

  test('break skips the next loop end marker without executing that marker', async () => {
    const result = await run([
      loop('2'), { type: 'v2BreakLoop', indent: 1 }, loop('3', 1),
      set('skipped', '1', 2), end(2, true), set('count', '1', 1, 'value', '+='), end(1, true),
    ], { count: '0' });
    expect(result.saved).toEqual({ count: '2' });
  });

  test('a skipped loop end does not clear its local variables', async () => {
    const result = await run([
      loop('2'), local('scratch', 'value', 1), { type: 'v2BreakLoop', indent: 1 }, end(1, true),
      set('copied', 'scratch', 1, 'var'), end(1), set('cleared', 'scratch', 1, 'var'),
    ]);
    expect(result.saved).toEqual({ copied: 'value', cleared: 'null' });
  });

  test.each(['0', '1'])('conditional %s selects one branch and clears only executed boundaries', async source => {
    const result = await run([
      local('outer', 'original', 0),
      { type: 'v2IfAdvanced', source, sourceType: 'value', target: '1', targetType: 'value', condition: '=', indent: 0 },
      local('outer', 'then', 1), local('inner', 'then', 1), end(1), { type: 'v2Else', indent: 0 },
      local('outer', 'else', 1), local('inner', 'else', 1), end(1),
      set('selected', 'outer', 0, 'var'), set('cleared', 'inner', 1, 'var'),
    ]);
    expect(result.saved).toEqual({ selected: source === '1' ? 'then' : 'else', cleared: 'null' });
  });

  test('a break with no following loop end stops the instruction sequence', async () => {
    const result = await run([set('before', 'yes'), { type: 'v2BreakLoop', indent: 0 }, set('after', 'no')]);
    expect(result.saved).toEqual({ before: 'yes' });
  });

  test('serialized nonnumeric indents remain distinct from numeric scopes', async () => {
    const result = await run([
      { type: 'v2DeclareLocalVar', var: 'value', value: 'local', valueType: 'value', indent: '01' },
      set('copied', 'value', 1, 'var'),
    ], { value: 'saved' });
    expect(result.saved).toEqual({ value: 'saved', copied: 'saved' });
  });

});

test.each(['manual', 'output'] as const)('%s dispatch shares locals between siblings and isolates nested calls', async binding => {
  let saved: unknown = { value: 'saved' };
  const api = {
    chat: {
      getMetadata: async (key: string) => key === 'chat_variables' ? saved : {},
      setMetadata: async (_key: string, value: unknown) => { saved = value; },
      getMessages: async () => [],
    },
    characters: { get: async () => ({ id: 'character' }) },
  } as unknown as HostApi;
  const sources: TriggerScript[] = [
    { type: binding, comment: 'batch', conditions: [], effect: [local('value', 'parent', 0), { type: 'v2RunTrigger', target: 'child', indent: 0 }] },
    { type: binding, comment: 'batch', conditions: [], effect: [set('sibling', 'value', 0, 'var')] },
    { type: 'input', comment: 'child', conditions: [], effect: [set('childRead', 'value', 0, 'var'), local('value', 'child', 0), set('childLocal', 'value', 0, 'var')] },
    { type: 'input', comment: 'fresh', conditions: [], effect: [set('fresh', 'value', 0, 'var')] },
  ];
  const compiledTriggers = prepareTriggers({ triggers: sources } as unknown as RisuPayload, 'character');
  const scriptNS = makeDispatcherScriptNS();
  registerManualTriggers(scriptNS, compiledTriggers, api);
  const context = { compiledTriggers, api, data: {}, scriptNS, opts: {} };
  if (binding === 'manual') await dispatchByManualName(context, 'batch');
  else await dispatchBinding(context, 'output');
  await dispatchByManualName(context, 'fresh');
  expect(saved).toEqual({ value: 'saved', childRead: 'saved', childLocal: 'child', sibling: 'parent', fresh: 'saved' });
});
