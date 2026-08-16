import { describe, expect, test } from 'bun:test';

import type { PendingRegexScriptMsg } from '../types/messages.js';
import { ensureRegexOwnership } from './regex-ownership.js';

function script(id: string): PendingRegexScriptMsg {
  return {
    name: id,
    script_id: id,
    find_regex: 'x',
    replace_string: 'y',
    flags: 'g',
    placement: ['ai_output'],
    scope: 'character',
    scope_id: 'char-1',
    target: 'display',
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    run_on_edit: false,
    substitute_macros: 'none',
    disabled: false,
    sort_order: 0,
    description: '',
    folder: '',
    metadata: {},
  };
}

function api(existing: Array<{ id: string; script_id: string; can_mutate?: boolean }> = []) {
  const created: string[] = [];
  const updated: string[] = [];
  return {
    created,
    updated,
    value: {
      list: async () => ({ data: existing, total: existing.length }),
      create: async (input: { script_id?: string }) => {
        created.push(input.script_id ?? '');
        return { ...input, id: `row-${input.script_id}` };
      },
      update: async (id: string) => {
        updated.push(id);
        return { id };
      },
    },
  };
}

describe('ensureRegexOwnership', () => {
  test('creates only missing rows', async () => {
    const mock = api([{ id: 'row-owned', script_id: 'owned', can_mutate: true }]);
    const result = await ensureRegexOwnership(
      mock.value as never,
      [script('owned'), script('new')],
      'user-1',
    );
    expect(result).toMatchObject({
      allOwned: true,
      created: 1,
      alreadyOwned: 1,
      unowned: 0,
      failed: 0,
    });
    expect(mock.created).toEqual(['new']);
    expect(mock.updated).toEqual(['row-owned']);
  });

  test('leaves an existing unowned row untouched and blocks cleanup', async () => {
    const mock = api([{ id: 'row-old', script_id: 'old', can_mutate: false }]);
    const result = await ensureRegexOwnership(mock.value as never, [script('old')], 'user-1');
    expect(result.allOwned).toBe(false);
    expect(result.unowned).toBe(1);
    expect(mock.created).toEqual([]);
    expect(mock.updated).toEqual([]);
  });

  test('blocks cleanup when an owned row cannot be refreshed', async () => {
    const mock = api([{ id: 'row-owned', script_id: 'owned', can_mutate: true }]);
    mock.value.update = async () => { throw new Error('rejected'); };
    const result = await ensureRegexOwnership(mock.value as never, [script('owned')], 'user-1');
    expect(result).toMatchObject({ allOwned: false, alreadyOwned: 0, failed: 1 });
  });

  test('reports create failure without mutating another row', async () => {
    const mock = api();
    mock.value.create = async () => { throw new Error('rejected'); };
    const result = await ensureRegexOwnership(mock.value as never, [script('new')], 'user-1');
    expect(result).toMatchObject({
      allOwned: false,
      created: 0,
      alreadyOwned: 0,
      unowned: 0,
      failed: 1,
    });
  });

  test('normalizes ids exactly once before create and cleanup verification', async () => {
    const mock = api();
    const result = await ensureRegexOwnership(mock.value as never, [script('A-B C')], 'user-1');
    expect(result.scripts[0]?.script_id).toBe('a_b_c');
    expect(mock.created).toEqual(['a_b_c']);
  });
});
