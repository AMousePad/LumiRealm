/**
 * Pin behaviour of the pure module → Lumi-artifact projection
 * helpers. These convert a Risu module body's `lorebook[]` / `regex[]`
 * arrays into the wire shapes Lumi's REST routes accept.
 */

import { describe, test, expect } from 'bun:test';
import {
  projectModuleLorebookEntries,
  projectModuleRegexEntries,
  recoverModuleRegexScriptIds,
  riskCustomScriptTypeToLumi,
} from '../../src/state/module-artifact-project.js';

const idGen = (() => {
  let n = 0;
  return () => `id-${++n}`;
})();

describe('projectModuleLorebookEntries', () => {
  test('returns empty array when raw is undefined', () => {
    expect(projectModuleLorebookEntries('mod-X', undefined)).toEqual([]);
  });

  test('returns empty array when raw is not an array', () => {
    expect(projectModuleLorebookEntries('mod-X', 'not-an-array' as unknown as readonly unknown[]))
      .toEqual([]);
  });

  test('skips non-object entries silently', () => {
    const out = projectModuleLorebookEntries('mod-X', [
      null,
      undefined,
      'string',
      42,
      { key: ['k'], content: 'c' },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]!.key).toEqual(['k']);
  });

  test('forwards key array verbatim', () => {
    const out = projectModuleLorebookEntries('mod-X', [
      { key: ['alice', 'bob'], content: 'hello' },
    ]);
    expect(out[0]!.key).toEqual(['alice', 'bob']);
  });

  test('coerces string key to single-element array', () => {
    const out = projectModuleLorebookEntries('mod-X', [
      { key: 'alice', content: 'hello' },
    ]);
    expect(out[0]!.key).toEqual(['alice']);
  });

  test('drops non-string items from key array', () => {
    const out = projectModuleLorebookEntries('mod-X', [
      { key: ['alice', 42, null, 'bob'], content: 'hi' },
    ]);
    expect(out[0]!.key).toEqual(['alice', 'bob']);
  });

  test('skips entries with no key AND no content', () => {
    const out = projectModuleLorebookEntries('mod-X', [
      { key: [], content: '' },
      { key: ['kept'], content: '' },
      { key: [], content: 'kept too' },
    ]);
    expect(out.length).toBe(2);
  });

  test('forwards optional fields when present + correct type', () => {
    const out = projectModuleLorebookEntries('mod-X', [{
      key: ['k'], content: 'c',
      comment: 'a comment',
      constant: true,
      disabled: false,
      position: 'before_char',
      priority: 5,
      order: 100,
      secondary_keys: ['sec1', 'sec2'],
      selective: true,
    }]);
    expect(out[0]!.comment).toBe('a comment');
    expect(out[0]!.constant).toBe(true);
    expect(out[0]!.disabled).toBe(false);
    expect(out[0]!.position).toBe('before_char');
    expect(out[0]!.priority).toBe(5);
    expect(out[0]!.order).toBe(100);
    expect(out[0]!.secondary_keys).toEqual(['sec1', 'sec2']);
    expect(out[0]!.selective).toBe(true);
  });

  test('drops optional fields with wrong types (defensive)', () => {
    const out = projectModuleLorebookEntries('mod-X', [{
      key: ['k'], content: 'c',
      priority: 'should-be-number',
      constant: 'should-be-boolean',
      secondary_keys: 'should-be-array',
    }]);
    expect(out[0]!.priority).toBeUndefined();
    expect(out[0]!.constant).toBeUndefined();
    expect(out[0]!.secondary_keys).toBeUndefined();
  });

  test('every entry carries metadata._risu.module_id', () => {
    const out = projectModuleLorebookEntries('mod-DIAG', [
      { key: ['k1'], content: 'c1' },
      { key: ['k2'], content: 'c2' },
    ]);
    expect(out.length).toBe(2);
    for (const e of out) {
      const meta = e.metadata as { _risu?: { module_id?: string } } | undefined;
      expect(meta?._risu?.module_id).toBe('mod-DIAG');
    }
  });
});

describe('riskCustomScriptTypeToLumi', () => {
  test.each([
    ['editinput', { placement: ['user_input'], target: 'prompt' as const, disabled: false }],
    ['editprocess', {
      placement: ['user_input', 'ai_output'],
      target: 'prompt' as const,
      disabled: false,
    }],
    ['editoutput', { placement: ['ai_output'], target: 'response' as const, disabled: false }],
    ['edittrans', {
      placement: ['ai_output', 'user_input'],
      target: 'display' as const,
      disabled: true,
    }],
    ['editdisplay', {
      placement: ['ai_output', 'user_input'],
      target: 'display' as const,
      disabled: false,
    }],
    ['disabled', {
      placement: ['ai_output', 'user_input'],
      target: 'display' as const,
      disabled: true,
    }],
  ] as const)('maps Risu type %s to Lumi shape', (input, expected) => {
    expect(riskCustomScriptTypeToLumi(input)).toEqual(expected);
  });

  test('unknown type defaults to editdisplay', () => {
    expect(riskCustomScriptTypeToLumi('totally-made-up')).toEqual({
      placement: ['ai_output', 'user_input'],
      target: 'display',
      disabled: false,
    });
  });
});

describe('projectModuleRegexEntries', () => {
  test('returns empty when raw is undefined', () => {
    expect(projectModuleRegexEntries('mod', 'M', 'char-1', undefined, idGen)).toEqual([]);
  });

  test('skips non-object entries + entries with empty `in`', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      null,
      'string',
      { in: '', out: 'replacement' },
      { in: '/match/', out: 'replacement' },
    ], idGen);
    expect(out.length).toBe(1);
    expect(out[0]!.find_regex).toBe('/match/');
  });

  test('default flag is g; empty-string flag falls back to u (Risu char-filter default)', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/x/', out: 'y' },
      { in: '/x/', out: 'y', flag: '' },
    ], idGen);
    expect(out[0]!.flags).toBe('g');
    expect(out[1]!.flags).toBe('u');
  });

  test('drops u flag when a CBS-enabled find contains macro braces', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '{{cbs}}', out: 'y', flag: 'gu<cbs>' },
    ], idGen);
    expect(out[0]!.flags).toBe('g');
    expect(out[0]!.substitute_macros).toBe('find');
  });

  test('keeps u flag when find_regex has no CBS', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/match/', out: 'y', flag: 'gu' },
    ], idGen);
    expect(out[0]!.flags).toContain('u');
  });

  test('strips invalid flag chars (Risu set [dgimsuvy])', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/x/', out: 'y', flag: 'gXyZ%qi' },
    ], idGen);
    expect([...out[0]!.flags].sort().join('')).toEqual([...'giy'].sort().join(''));
  });

  test('strips Risu flag-meta brackets; <move_top> force-strips g (Risu parity)', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/a/', out: 'b', flag: 'g<order -1>' },
      { in: '/c/', out: 'd', flag: '<move_top>g' },
      { in: '/e/', out: 'f', flag: 'g<no_end_nl>i' },
    ], idGen);
    expect(out[0]!.flags).toBe('g');
    expect(out[1]!.flags).toBe('u');
    expect(out[2]!.flags).toBe('gi');
  });

  test('dedup flag chars', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/x/', out: 'y', flag: 'gggii' },
    ], idGen);
    expect([...out[0]!.flags].sort().join('')).toEqual([...'gi'].sort().join(''));
  });

  test('per-message {{chat_index}} gate forces substitute_macros=after; plain macro stays escaped', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/p/', out: '{{#if {{equal::{{chat_index}}::{{lastmessageid}}}}}}x{{/if}}' },
      { in: '/q/', out: '{{#if {{equal::{{getvar::lang}}::0}}}}y{{/if}}' },
      { in: '/r/', out: 'no macros here' },
    ], idGen);
    expect(out[0]!.substitute_macros).toBe('after');
    expect(out[1]!.substitute_macros).toBe('escaped');
    expect(out[2]!.substitute_macros).toBe('none');
  });

  test('divider rules (empty in + non-empty comment) emit as never-match disabled rows', () => {
    const out = projectModuleRegexEntries('mod-id', 'M', 'char-1', [
      { in: '/a/', out: 'b', comment: 'rule_a' },
      { in: '', out: '', comment: '---Future Plan---' },
      { in: '/c/', out: 'd', comment: 'rule_c' },
    ], idGen);
    expect(out.length).toBe(3);
    expect(out[1]!.find_regex).toBe('(?!)');
    expect(out[1]!.disabled).toBe(true);
    expect(out[1]!.name).toBe('---Future Plan---');
    const meta = out[1]!.metadata as { _risu?: { source_type?: string } };
    expect(meta._risu?.source_type).toBe('divider');
    expect(new RegExp(out[1]!.find_regex, out[1]!.flags).test('any text')).toBe(false);
  });

  test('rules with empty in AND empty comment are dropped entirely', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/a/', out: 'b' },
      { in: '', out: '' },
      { in: '/c/', out: 'd' },
    ], idGen);
    expect(out.length).toBe(2);
    expect(out[0]!.find_regex).toBe('/a/');
    expect(out[1]!.find_regex).toBe('/c/');
  });

  test('uses Risu comment as name; missing comment falls back to rule_N (no module-name prefix)', () => {
    const out = projectModuleRegexEntries('mod-id', 'Touhou', 'char-1', [
      { in: '/a/', out: 'b' },
      { in: '/c/', out: 'd', comment: 'Custom Rule' },
    ], idGen);
    expect(out[0]!.name).toBe('rule_1');
    expect(out[1]!.name).toBe('Custom Rule');
  });

  test('script_id comes from idGen (caller-supplied)', () => {
    const localGen = (() => { let i = 100; return () => `seeded-${++i}`; })();
    const out = projectModuleRegexEntries('mod', 'M', 'char-1', [
      { in: '/a/', out: 'b' },
      { in: '/c/', out: 'd' },
    ], localGen);
    expect(out[0]!.script_id).toBe('seeded-101');
    expect(out[1]!.script_id).toBe('seeded-102');
  });

  test('scope is character + scope_id matches characterId', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'CHAR_42', [
      { in: '/x/', out: 'y' },
    ], idGen);
    expect(out[0]!.scope).toBe('character');
    expect(out[0]!.scope_id).toBe('CHAR_42');
  });

  test('sort_order starts at 1000 + index (after character rules)', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/a/', out: 'b' },
      { in: '/c/', out: 'd' },
      { in: '/e/', out: 'f' },
    ], idGen);
    expect(out.map((r) => r.sort_order)).toEqual([1000, 1001, 1002]);
  });

  test('substitute_macros = "escaped" when out has CBS without captures, "after" with captures, "none" otherwise', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/a/', out: 'plain' },
      { in: '/b/', out: '{{user}} hi' },
      { in: '/(c)/', out: '{{lower::$1}}' },
    ], idGen);
    expect(out[0]!.substitute_macros).toBe('none');
    expect(out[1]!.substitute_macros).toBe('escaped');
    expect(out[2]!.substitute_macros).toBe('after');
  });

  test('every emitted script carries metadata._risu.{module_id, source_type}', () => {
    const out = projectModuleRegexEntries('mod-XYZ', 'M', 'char', [
      { in: '/a/', out: 'b', type: 'editoutput' },
    ], idGen);
    const meta = out[0]!.metadata as { _risu?: { module_id?: string; source_type?: string } };
    expect(meta._risu?.module_id).toBe('mod-XYZ');
    expect(meta._risu?.source_type).toBe('editoutput');
  });

  test('editinput rule gets max_depth = 0 (pending message only)', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/a/', out: 'b', type: 'editinput' },
    ], idGen);
    expect(out[0]!.max_depth).toBe(0);
  });

  test('non-editinput rules have max_depth null', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/a/', out: 'b', type: 'editdisplay' },
      { in: '/c/', out: 'd', type: 'editoutput' },
    ], idGen);
    expect(out[0]!.max_depth).toBeNull();
    expect(out[1]!.max_depth).toBeNull();
  });

  test('disabled rule type lands with disabled=true', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/a/', out: 'b', type: 'disabled' },
    ], idGen);
    expect(out[0]!.disabled).toBe(true);
  });

  test('folder is "Module: <ModuleName>" so Lumi UI groups them', () => {
    const out = projectModuleRegexEntries('mod', 'TouhouLightboard', 'char', [
      { in: '/a/', out: 'b' },
    ], idGen);
    expect(out[0]!.folder).toBe('Module: TouhouLightboard');
  });

  test('stores module display HTML raw (resolver wraps the whole message)', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      {
        in: '<sys>(.+?)</sys>',
        out: '<style>.panel { color: red; }</style><div class="panel">$1</div>',
        type: 'editdisplay',
      },
    ], idGen);
    expect(out[0]!.replace_string).toBe(
      '<style>.panel { color: red; }</style><div class="panel">$1</div>\n',
    );
  });

  test('maps direct move actions to neutral host metadata', () => {
    const replace = '@@move_top <style>.panel { color: red; }</style><div>UI</div>';
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      {
        in: '<panel>(.+?)</panel>',
        out: replace,
        type: 'editdisplay',
      },
    ], idGen);
    expect(out[0]!.replace_string).not.toContain('@@move_top');
    expect(out[0]!.metadata).toMatchObject({
      match_actions: ['move_top'],
    });
    expect(out[0]!.replace_string).toContain(
      '<div data-lr-style-wrap class="not-island-prose">',
    );
  });

  test('preserves raw-match repeat behavior in host metadata', () => {
    const out = projectModuleRegexEntries('mod', 'M', 'char', [
      {
        in: '<status>[^<]+</status>',
        out: '<div>$&</div>',
        type: 'editdisplay',
        ableFlag: true,
        flag: 'g<repeat_back>',
      },
    ], idGen);
    expect(out[0]!.metadata).toMatchObject({
      match_actions: ['repeat_back'],
      repeat_raw_match: true,
    });
  });
});

describe('recoverModuleRegexScriptIds', () => {
  test('restores source order when host list order follows regex sort order', () => {
    const projected = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/first/', out: 'a' },
      { in: '/moved/', out: 'b', flag: 'g<order -1>' },
      { in: '/action/', out: 'c', flag: '<move_top>g' },
    ], () => crypto.randomUUID());
    const live = [
      { id: 'live-first', metadata: projected[0]!.metadata },
      { id: 'live-action', metadata: projected[2]!.metadata },
      { id: 'live-moved', metadata: projected[1]!.metadata },
    ];

    expect(recoverModuleRegexScriptIds('mod', projected, live)).toEqual({
      ids: ['live-first', 'live-moved', 'live-action'],
      exact: true,
    });
  });

  test('falls back to cleanup ids when source identity is incomplete', () => {
    const projected = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/first/', out: 'a' },
      { in: '/second/', out: 'b' },
    ], () => crypto.randomUUID());
    const live = [
      { id: 'live-first', metadata: projected[0]!.metadata },
      { id: 'live-incomplete', metadata: { _risu: { module_id: 'mod' } } },
    ];

    expect(recoverModuleRegexScriptIds('mod', projected, live)).toEqual({
      ids: ['live-first', 'live-incomplete'],
      exact: false,
    });
  });

  test('appends unbound module rows after the source-indexed binding slots', () => {
    const projected = projectModuleRegexEntries('mod', 'M', 'char', [
      { in: '/first/', out: 'a' },
      { in: '/second/', out: 'b' },
    ], () => crypto.randomUUID());
    const live = [
      { id: 'live-second', metadata: projected[1]!.metadata },
      { id: 'live-orphan', metadata: { _risu: { module_id: 'mod' } } },
      { id: 'live-first', metadata: projected[0]!.metadata },
    ];

    expect(recoverModuleRegexScriptIds('mod', projected, live)).toEqual({
      ids: ['live-first', 'live-second', 'live-orphan'],
      exact: true,
    });
  });
});
