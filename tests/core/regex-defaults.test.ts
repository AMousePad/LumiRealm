import { expect, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { projectModuleRegexEntries } from '../../src/state/module-artifact-project.js';

test('empty enabled flags preserve global replacement and non-Unicode identity escapes', () => {
  const script = { comment: 'repair', type: 'editoutput', in: 'a\\-b', out: 'fixed', ableFlag: true, flag: '' };
  const card = mapRegex([script], { characterId: 'character' }).rows[0]!;
  const module = projectModuleRegexEntries('module', 'Module', 'character', [script], () => 'row')[0]!;
  for (const row of [card, module]) {
    expect(row.flags).toBe('g');
    expect('a-b a-b'.replace(new RegExp(row.find_regex, row.flags), row.replace_string)).toBe('fixed fixed');
  }
});

test('module flags are ignored when ableFlag is absent or false, as in processScriptFull', () => {
  const scripts = [undefined, false, true].map((ableFlag) => ({
    type: 'editoutput', in: 'a', out: 'x', flag: 'i', ableFlag,
  }));
  const rows = projectModuleRegexEntries('module', 'Module', 'character', scripts, () => 'row');
  expect(rows.map((row) => row.flags)).toEqual(['g', 'g', 'i']);
  expect(rows.map((row) => 'A a a'.replace(new RegExp(row.find_regex, row.flags), row.replace_string)))
    .toEqual(['A x x', 'A x x', 'x a a']);
});
