import { describe, expect, test } from 'bun:test';
import {
  collectModuleToggleDsl,
  extractToggleKeys,
  groupToggles,
  parseToggleSyntax,
  type SidebarToggle,
} from '../../src/core/toggle-syntax.js';

// Direct port of Risu's `parseToggleSyntax` semantics: every test here
// corresponds to a behaviour observable in Risu's toggle-string parser
// and its sidebar toggle renderer.

describe('parseToggleSyntax', () => {
  test('empty / null / undefined input → []', () => {
    expect(parseToggleSyntax('')).toEqual([]);
    expect(parseToggleSyntax(null)).toEqual([]);
    expect(parseToggleSyntax(undefined)).toEqual([]);
  });

  test('simple checkbox', () => {
    expect(parseToggleSyntax('enable_cot=Enable Chain-of-Thought')).toEqual([
      { key: 'enable_cot', value: 'Enable Chain-of-Thought', type: undefined, options: [] },
    ]);
  });

  test('select with options', () => {
    expect(parseToggleSyntax('model=Choose Model=select=gpt-4,gpt-3.5,claude')).toEqual([
      {
        key: 'model',
        value: 'Choose Model',
        type: 'select',
        options: ['gpt-4', 'gpt-3.5', 'claude'],
      },
    ]);
  });

  test('text + textarea', () => {
    expect(parseToggleSyntax('prompt=Custom Prompt=text')).toEqual([
      { key: 'prompt', value: 'Custom Prompt', type: 'text', options: [] },
    ]);
    expect(parseToggleSyntax('desc=Description=textarea')).toEqual([
      { key: 'desc', value: 'Description', type: 'textarea', options: [] },
    ]);
  });

  test('group / groupEnd / divider / caption markers', () => {
    const flat = parseToggleSyntax(
      ['=Appearance=group',
       '=tagline=caption',
       'show_avatar=Show Avatar',
       '==groupEnd',
       '=Section break=divider'].join('\n'),
    );
    expect(flat).toEqual([
      { value: 'Appearance', type: 'group', children: [] },
      { value: 'tagline', type: 'caption' },
      { key: 'show_avatar', value: 'Show Avatar', type: undefined, options: [] },
      { type: 'groupEnd' },
      { value: 'Section break', type: 'divider' },
    ]);
  });

  test('caption REQUIRES non-empty value (Risu gate at util.ts:1068)', () => {
    expect(parseToggleSyntax('==caption')).toEqual([]);
    expect(parseToggleSyntax('=hello=caption')).toEqual([
      { value: 'hello', type: 'caption' },
    ]);
  });

  test('plain row missing key OR value → dropped (Risu gate `if(key && value)`)', () => {
    expect(parseToggleSyntax('=label')).toEqual([]); // missing key
    expect(parseToggleSyntax('key=')).toEqual([]); // missing value
    expect(parseToggleSyntax('=')).toEqual([]); // both empty
  });

  test('unknown type falls back to checkbox (undefined type)', () => {
    expect(parseToggleSyntax('foo=Foo=bogus')).toEqual([
      { key: 'foo', value: 'Foo', type: undefined, options: [] },
    ]);
  });

  test('multiple lines, mixed types', () => {
    const dsl = [
      'enable=Enable feature',
      'mode=Mode=select=fast,thorough',
      '=appearance=group',
      'avatar=Show avatar',
      '==groupEnd',
    ].join('\n');
    expect(parseToggleSyntax(dsl)).toHaveLength(5);
  });

  test('select with single option (no commas)', () => {
    expect(parseToggleSyntax('m=Mode=select=only')).toEqual([
      { key: 'm', value: 'Mode', type: 'select', options: ['only'] },
    ]);
  });

  test('select with no options string → empty options', () => {
    expect(parseToggleSyntax('m=Mode=select')).toEqual([
      { key: 'm', value: 'Mode', type: 'select', options: [] },
    ]);
  });

  test('blank lines silently skipped', () => {
    expect(parseToggleSyntax('\n\nenable=A\n\n')).toEqual([
      { key: 'enable', value: 'A', type: undefined, options: [] },
    ]);
  });
});

describe('groupToggles', () => {
  test('flat list with no groups → unchanged', () => {
    const flat: SidebarToggle[] = [
      { key: 'a', value: 'A', type: undefined, options: [] },
      { key: 'b', value: 'B', type: undefined, options: [] },
    ];
    expect(groupToggles(flat)).toEqual(flat);
  });

  test('group … groupEnd nests children, drops groupEnd', () => {
    const flat = parseToggleSyntax(
      ['enable=Enable',
       '=Appearance=group',
       'avatar=Show avatar',
       'theme=Theme=select=dark,light',
       '==groupEnd',
       'verbose=Verbose'].join('\n'),
    );
    const grouped = groupToggles(flat);
    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ key: 'enable' });
    expect(grouped[1]).toMatchObject({ type: 'group', value: 'Appearance' });
    const grp = grouped[1] as { type: 'group'; children: SidebarToggle[] };
    expect(grp.children).toHaveLength(2);
    expect(grp.children[0]).toMatchObject({ key: 'avatar' });
    expect(grouped[2]).toMatchObject({ key: 'verbose' });
  });

  test('groupEnd without open group → silently dropped', () => {
    const flat = parseToggleSyntax(['a=A', '==groupEnd', 'b=B'].join('\n'));
    expect(groupToggles(flat)).toHaveLength(2);
  });

  test('group never closed → trailing entries collected into open group', () => {
    const flat = parseToggleSyntax(['=Group=group', 'a=A', 'b=B'].join('\n'));
    const grouped = groupToggles(flat);
    expect(grouped).toHaveLength(1);
    const grp = grouped[0] as { type: 'group'; children: SidebarToggle[] };
    expect(grp.children).toHaveLength(2);
  });

  test('second `group` while one open → opens new group alongside (Risu reducer parity)', () => {
    const flat = parseToggleSyntax(
      ['=G1=group', 'a=A', '=G2=group', 'b=B'].join('\n'),
    );
    const grouped = groupToggles(flat);
    expect(grouped).toHaveLength(2);
    expect((grouped[0] as { children: SidebarToggle[] }).children).toHaveLength(1);
    expect((grouped[1] as { children: SidebarToggle[] }).children).toHaveLength(1);
  });
});

describe('collectModuleToggleDsl', () => {
  test('no modules → empty', () => {
    expect(collectModuleToggleDsl([])).toBe('');
  });

  test('skips modules without DSL', () => {
    expect(
      collectModuleToggleDsl([
        { customModuleToggle: undefined },
        { customModuleToggle: '' },
        { customModuleToggle: null },
      ]),
    ).toBe('');
  });

  test('newline-sandwich concatenation matches Risu getModuleToggles', () => {
    const out = collectModuleToggleDsl([
      { customModuleToggle: 'a=A' },
      { customModuleToggle: 'b=B' },
    ]);
    expect(out).toBe('\na=A\n\nb=B\n');
  });

  test('preserves order across modules', () => {
    const out = collectModuleToggleDsl([
      { customModuleToggle: 'first=First' },
      { customModuleToggle: 'second=Second' },
    ]);
    const parsed = parseToggleSyntax(out);
    expect(parsed.map((t) => ('key' in t ? t.key : null))).toEqual(['first', 'second']);
  });
});

describe('extractToggleKeys', () => {
  test('returns interactive keys only, deduped, ordered', () => {
    const flat = parseToggleSyntax(
      ['enable=Enable',
       '=Group=group',
       'mode=Mode=select=a,b',
       '=Caption=caption',
       'enable=Enable redux',  // dup — drop
       '==groupEnd',
       'desc=Description=textarea'].join('\n'),
    );
    expect(extractToggleKeys(flat)).toEqual(['enable', 'mode', 'desc']);
  });

  test('empty for groups-and-captions-only DSL', () => {
    const flat = parseToggleSyntax('=Title=caption\n==divider\n=G=group\n==groupEnd');
    expect(extractToggleKeys(flat)).toEqual([]);
  });
});
