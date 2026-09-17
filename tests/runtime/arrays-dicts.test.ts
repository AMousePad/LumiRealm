import { describe, expect, test } from 'bun:test';
import { makeVarsApi } from '../../src/interpreter/runtime/vars.js';
import { runCollectionEffect } from '../../src/interpreter/runtime/arrays-dicts.js';
import type { TriggerEffect } from '../../src/core/schemas/triggerscript.js';

function setup(initial: string, parseTemplate?: (text: string) => string) {
  const cache: Record<string, string | null> = { $list: initial };
  const vars = makeVarsApi({ varsCache: cache, localScopes: new Map(), dirty: { value: false }, characterId: null, ...(parseTemplate ? { parseTemplate } : {}) });
  const run = (type: string, fields: Partial<TriggerEffect> = {}) => runCollectionEffect(vars, {
    type, var: 'list', varType: 'var', outputVar: 'out', index: '1', indexType: 'value',
    value: 'b', valueType: 'value', start: '1', startType: 'value', end: '3', endType: 'value',
    delimiter: '|', delimiterType: 'value', key: 'key', keyType: 'value', item: 'x', itemType: 'value', ...fields,
  });
  return { cache, vars, run };
}

describe('Risu runTrigger collection writes', () => {
  for (const [type, initial, stored, result] of [
    ['v2GetArrayVarLength', '["a","b"]', '["a","b"]', '2'],
    ['v2GetArrayVar', '["a","b"]', '["a","b"]', 'b'],
    ['v2GetArrayVar', '[]', '[]', 'null'],
    ['v2SetArrayVar', '["a","c"]', '["a","b"]', undefined],
    ['v2PushArrayVar', '["a"]', '["a","b"]', undefined],
    ['v2PopArrayVar', '["a","b"]', '["a"]', 'b'],
    ['v2PopArrayVar', '[]', '[]', 'null'],
    ['v2ShiftArrayVar', '["a","b"]', '["b"]', 'a'],
    ['v2UnshiftArrayVar', '["a"]', '["b","a"]', undefined],
    ['v2SpliceArrayVar', '["a","c"]', '["a","x","c"]', undefined],
    ['v2SliceArrayVar', '["0","1","2","3"]', '["0","1","2","3"]', '["1","2"]'],
    ['v2JoinArrayVar', '["a","b"]', '["a","b"]', 'a|b'],
    ['v2GetIndexOfValueInArrayVar', '["a","b"]', '["a","b"]', '1'],
    ['v2GetIndexOfValueInArrayVar', '[]', '[]', '-1'],
    ['v2RemoveIndexFromArrayVar', '["a","b","c"]', '["a","c"]', undefined],
    ['v2GetDictVar', '{"key":"v"}', '{"key":"v"}', 'v'],
    ['v2GetDictVar', '{}', '{}', 'null'],
    ['v2SetDictVar', '{}', '{"key":"b"}', undefined],
    ['v2DeleteDictKey', '{"key":"v"}', '{}', undefined],
    ['v2HasDictKey', '{"key":"v"}', '{"key":"v"}', '1'],
    ['v2HasDictKey', '{}', '{}', '0'],
    ['v2GetDictSize', '{"a":"1","b":"2"}', '{"a":"1","b":"2"}', '2'],
    ['v2GetDictKeys', '{"a":"1","b":"2"}', '{"a":"1","b":"2"}', '["a","b"]'],
    ['v2GetDictValues', '{"a":"1","b":"2"}', '{"a":"1","b":"2"}', '["1","2"]'],
    ['v2PushArrayVar', 'bad JSON', '[]', undefined],
    ['v2SetArrayVar', 'bad JSON', 'bad JSON', undefined],
    ['v2GetArrayVarLength', 'bad JSON', 'bad JSON', '0'],
    ['v2GetArrayVar', 'bad JSON', 'bad JSON', 'null'],
    ['v2SetDictVar', 'bad JSON', '{"key":"b"}', undefined],
    ['v2DeleteDictKey', 'bad JSON', '{}', undefined],
    ['v2GetDictSize', 'null', 'null', '0'],
    ['v2GetArrayVarLength', '"abc"', '"abc"', '3'],
    ['v2GetArrayVar', '"abc"', '"abc"', 'b'],
    ['v2GetDictKeys', '"abc"', '"abc"', '["0","1","2"]'],
  ] as const) {
    test(`${type} on ${initial}`, () => {
      const { run, cache } = setup(initial);
      run(type);
      expect(cache.$list).toBe(stored);
      expect(cache.$out).toBe(result);
    });
  }

  test('invalid JSON skips later operand parsing', () => {
    const parsed: string[] = [];
    const { run, cache } = setup('bad JSON', text => { parsed.push(text); return text; });
    run('v2GetArrayVar');
    expect(parsed).toEqual(['list', 'out']);
    expect(cache.$out).toBe('null');
  });

  test('valid non-array JSON still parses the mutation operand before failing', () => {
    const parsed: string[] = [];
    const { run, cache } = setup('null', text => { parsed.push(text); return text; });
    run('v2PushArrayVar');
    expect(parsed).toEqual(['list', 'b', 'list']);
    expect(cache.$list).toBe('[]');
  });

  test('indexed assignment resolves value and index before its collection name', () => {
    const parsed: string[] = [];
    const { run } = setup('[]', text => { parsed.push(text); return text; });
    run('v2SetArrayVar');
    expect(parsed).toEqual(['b', '1', 'list']);
  });

  test('an invalid index leaves the collection name unevaluated', () => {
    const parsed: string[] = [];
    const { run, cache } = setup('[]', text => { parsed.push(text); return text; });
    run('v2SetArrayVar', { index: 'bad' });
    expect(parsed).toEqual(['b', 'bad']);
    expect(cache.$list).toBe('[]');
  });

  test('a failed destination is parsed again by the collection fallback', () => {
    let attempts = 0;
    const { run, cache } = setup('["a"]', text => {
      if (text === 'out' && ++attempts === 1) throw new Error('template failure');
      return text;
    });
    run('v2PopArrayVar');
    expect(attempts).toBe(2);
    expect(cache).toEqual({ $list: '[]', $out: 'null' });
  });

  test('dict assignment retries operands and resolves its destination after recovery', () => {
    const parsed: string[] = [];
    const { run, cache } = setup('bad JSON', text => { parsed.push(text); return text; });
    run('v2SetDictVar');
    expect(parsed).toEqual(['b', 'key', 'list', 'b', 'key', 'list']);
    expect(cache.$list).toBe('{"key":"b"}');
  });

  test('literal dict assignment parses operands but does not write', () => {
    const parsed: string[] = [];
    const { run, cache } = setup('{}', text => { parsed.push(text); return text; });
    run('v2SetDictVar', { varType: 'value' });
    expect(parsed).toEqual(['b', 'key']);
    expect(cache.$list).toBe('{}');
  });
});
