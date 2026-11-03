import { describe, expect, test } from 'bun:test';
import {
  extractToggleKeys,
  parseToggleSyntax,
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
