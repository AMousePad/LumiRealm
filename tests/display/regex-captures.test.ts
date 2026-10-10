import { expect, test } from 'bun:test';
import { substituteRegexCaptures } from '../../src/display/regex-apply.js';

test('defined optional named captures become empty while unknown names stay literal', () => {
  const match = /(?<label>x)?y/.exec('y')!;
  expect(substituteRegexCaptures(
    '$<label>|$<unknown>', match[0], Array.from(match).slice(1), match.index, 'y', match.groups,
  )).toBe('|$<unknown>');
});
