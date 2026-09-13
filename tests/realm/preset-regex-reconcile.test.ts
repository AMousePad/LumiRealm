import { describe, expect, test } from 'bun:test';
import type { RegexScriptCreateDTO } from 'lumiverse-spindle-types';
import { presetRuleKey, reconcilePresetRegexScripts } from '../../src/realm/preset-regex-reconcile.js';
import { PRESET_NAME, makeRegexStore, seededRow, syntheticRule } from './preset-regex-fixture.js';

const USER = 'u1';

function reconcile(
  rules: readonly RegexScriptCreateDTO[],
  store: ReturnType<typeof makeRegexStore>,
  log?: { readonly info: (m: string) => void; readonly warn: (m: string) => void },
) {
  return reconcilePresetRegexScripts({
    api: store.api,
    userId: USER,
    presetName: PRESET_NAME,
    rules,
    ...(log ? { log } : {}),
    errMsg: (err) => (err instanceof Error ? err.message : String(err)),
  });
}

describe('presetRuleKey', () => {
  test('ignores label, order, metadata, and the user enable switch', () => {
    const plain = syntheticRule({ name: 'alpha' });
    const relabelled = syntheticRule({
      name: 'renamed by user',
      description: 'rewritten note',
      sort_order: 900,
      disabled: true,
      metadata: { extra: true },
    });
    expect(presetRuleKey(relabelled)).toBe(presetRuleKey(plain));
  });

  test('separates every substantive column', () => {
    const base = syntheticRule({ name: 'alpha' });
    const variants: RegexScriptCreateDTO[] = [
      { ...base, find_regex: '<other>(.+?)</other>' },
      { ...base, replace_string: 'replacement' },
      { ...base, flags: 'gu' },
      { ...base, placement: ['user_input'] },
      { ...base, target: 'response' },
      { ...base, scope_id: 'scope-1' },
      { ...base, min_depth: 1 },
      { ...base, max_depth: 4 },
      { ...base, trim_strings: ['trim me'] },
      { ...base, run_on_edit: true },
      { ...base, substitute_macros: 'raw' },
    ];
    const key = presetRuleKey(base);
    for (const variant of variants) {
      expect(presetRuleKey(variant)).not.toBe(key);
    }
    expect(presetRuleKey({ ...base, scope: 'character' })).not.toBe(key);
  });

  test('treats placement as a set', () => {
    const base = syntheticRule({ name: 'alpha', placement: ['ai_output', 'user_input'] });
    expect(presetRuleKey({ ...base, placement: ['user_input', 'ai_output'] })).toBe(presetRuleKey(base));
  });
});

describe('reconcilePresetRegexScripts', () => {
  test('creates every rule when the folder holds no managed rows', async () => {
    const store = makeRegexStore();
    const rules = [syntheticRule({ name: 'alpha' }), syntheticRule({ name: 'beta', find_regex: '<beta>' })];

    const result = await reconcile(rules, store);

    expect(result).toMatchObject({ managed: 0, created: 2, updated: 0, unchanged: 0, staleKept: 0, failed: 0 });
    expect(store.rowsFor(USER)).toHaveLength(2);
    expect(store.rowsFor(USER)[0]!.folder).toBe(PRESET_NAME);
  });

  test('reuses matching rows and reports them unchanged', async () => {
    const store = makeRegexStore();
    const rules = [syntheticRule({ name: 'alpha' }), syntheticRule({ name: 'beta', find_regex: '<beta>' })];

    await reconcile(rules, store);
    const result = await reconcile(rules, store);

    expect(result).toMatchObject({ managed: 2, created: 0, updated: 0, unchanged: 2, staleKept: 0 });
    expect(store.rowsFor(USER)).toHaveLength(2);
    expect(store.calls.create).toBe(2);
  });

  test('refreshes sort_order of a matched row when the archive reorders it', async () => {
    const rule = syntheticRule({ name: 'alpha', sort_order: 40 });
    const stale = syntheticRule({ name: 'alpha', sort_order: 0 });
    const store = makeRegexStore({ seed: [seededRow(stale, { id: 'owned-1', canMutate: true })] });

    const result = await reconcile([rule], store);

    expect(result).toMatchObject({ managed: 1, created: 0, updated: 1 });
    expect(store.rowsFor(USER)[0]!.sort_order).toBe(40);
  });

  test('keeps an unmatched managed row and reports it instead of deleting it', async () => {
    const dropped = syntheticRule({ name: 'dropped', find_regex: '<dropped>' });
    const kept = syntheticRule({ name: 'alpha' });
    const store = makeRegexStore({ seed: [seededRow(dropped, { id: 'owned-dropped', canMutate: true })] });
    const warns: string[] = [];

    const result = await reconcile([kept], store, { info: () => {}, warn: (m) => { warns.push(m); } });

    expect(result).toMatchObject({ managed: 1, created: 1, staleKept: 1 });
    expect(store.rowsFor(USER).map((r) => r.id)).toContain('owned-dropped');
    expect(warns.some((w) => w.includes('kept 1 unmatched row(s)'))).toBe(true);
    expect(warns.some((w) => w.includes('owned-dropped'))).toBe(true);
  });

  test('walks every page of the host listing', async () => {
    const rule = syntheticRule({ name: 'alpha' });
    const duplicates = Array.from({ length: 250 }, (_, index) =>
      seededRow(rule, { id: `dup-${String(index).padStart(3, '0')}`, canMutate: true }));
    const store = makeRegexStore({ seed: duplicates });

    const result = await reconcile([rule], store);

    expect(result.managed).toBe(250);
    expect(result.created).toBe(0);
    expect(result.staleKept).toBe(249);
    expect(store.calls.list).toBe(2);
  });

  test('still creates the rules when the listing fails, and says so', async () => {
    const store = makeRegexStore();
    const warns: string[] = [];
    const failing = {
      ...store.api,
      list: async () => { throw new Error('listing unavailable'); },
    };

    const result = await reconcilePresetRegexScripts({
      api: failing,
      userId: USER,
      presetName: PRESET_NAME,
      rules: [syntheticRule({ name: 'alpha' }), syntheticRule({ name: 'beta' })],
      log: { info: () => {}, warn: (m) => { warns.push(m); } },
      errMsg: (err) => (err instanceof Error ? err.message : String(err)),
    });

    expect(result).toMatchObject({ managed: 0, created: 2, listFailed: true });
    expect(store.rowsFor(USER)).toHaveLength(2);
    expect(warns.some((w) => w.includes('list failed'))).toBe(true);
  });
});
