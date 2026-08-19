import { describe, expect, test } from 'bun:test';

import type { LumiRegexScript } from '../core/lumiverse/types.js';
import {
  INVALID_SOURCE_REGEX_KEY,
  hostRegexCompileError,
  projectCharacterRegexScripts,
} from './character-regex-projection.js';

function row(overrides: Partial<LumiRegexScript>): LumiRegexScript {
  return {
    id: 'id',
    user_id: '',
    name: 'rule',
    script_id: 'rule',
    find_regex: 'a',
    replace_string: 'b',
    flags: 'g',
    placement: ['ai_output'],
    scope: 'character',
    scope_id: 'translator-id',
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
    pack_id: null,
    metadata: {},
    created_at: 0,
    updated_at: 0,
    ...overrides,
  } as LumiRegexScript;
}

describe('hostRegexCompileError', () => {
  test('accepts a macro pattern that only compiles after substitution', () => {
    // Raw `(` from the macro would fail; the host substitutes before compiling.
    expect(hostRegexCompileError('{{char(}}x', 'g', 'find')).toBeNull();
    expect(hostRegexCompileError('{{char(}}x', 'g', 'none')).not.toBeNull();
  });

  test('reports unmatched parentheses and bad flags', () => {
    expect(hostRegexCompileError('a)', 'g', 'none')).toMatch(/unmatched|Invalid/i);
    expect(hostRegexCompileError('a', 'gg', 'none')).not.toBeNull();
  });
});

describe('projectCharacterRegexScripts', () => {
  test('parks an uncompilable rule as a disabled never-match row', () => {
    const [projected] = projectCharacterRegexScripts(
      [row({ name: 'broken', find_regex: 'x(?:a))', flags: 'g' })],
      'char-1',
      'Ada',
    );
    expect(projected!.find_regex).toBe('(?!)');
    expect(projected!.disabled).toBe(true);
    expect(projected!.flags).toBe('g');
    expect(projected!.description).toContain('does not compile');
    expect(projected!.metadata[INVALID_SOURCE_REGEX_KEY]).toMatchObject({
      find_regex: 'x(?:a))',
      flags: 'g',
    });
  });

  test('leaves a compiling rule byte-identical', () => {
    const source = row({ name: 'fine', find_regex: '<img="([^"]+)">', flags: 'gu' });
    const [projected] = projectCharacterRegexScripts([source], 'char-1', 'Ada');
    expect(projected!.find_regex).toBe('<img="([^"]+)">');
    expect(projected!.flags).toBe('gu');
    expect(projected!.disabled).toBe(false);
    expect(projected!.metadata[INVALID_SOURCE_REGEX_KEY]).toBeUndefined();
  });

  test('rebinds character scope_id and falls back to a named folder', () => {
    const [projected] = projectCharacterRegexScripts([row({})], 'char-1', 'Ada');
    expect(projected!.scope_id).toBe('char-1');
    expect(projected!.folder).toBe('Risu — Ada');
  });
});
