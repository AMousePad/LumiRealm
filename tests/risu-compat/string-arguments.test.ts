import { expect, test } from 'bun:test';
import { makeMockContext } from '../../src/core/cbs/index.js';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { registry } from '../../src/risu-compat/index.js';

const parse = (template: string) => runPipeline({
  template, phase: 'display', visualize: false, reparseMacroResults: false,
  chatId: '', userName: 'User', charName: 'Character', character: {}, chat: {}, variables: {},
});

// Risu's registerCBS string callbacks throw on missing receivers; matcher preserves the macro.
test.each([
  'replace', 'split', 'join', 'spread', 'trim', 'length', 'lower', 'upper', 'capitalize',
  'startswith', 'endswith', 'contains', 'iserror',
])('%s requires its input argument', name => {
  expect(() => registry.get(name)!.handler(makeMockContext(), [], name)).toThrow(TypeError);
  expect(parse(`before {{${name}}} after`)).toBe(`before {{${name}}} after`);
});

test.each([
  ['{{replace::abc::b}}', 'aundefinedc'],
  ['{{replace::abc::b::}}', 'ac'],
  ['{{replace::ab::}}', 'undefinedaundefinedbundefined'],
  ['{{replace::::}}', 'undefined'],
  ['{{replace::::::}}', ''],
  ['{{replace::abc}}', 'abc'],
  ['{{replace::ab::::-}}', '-a-b-'],
  ['{{replace::abc::b::$&$&}}', 'abbc'],
  ['{{split::abc}}', '["abc"]'],
  ['{{split::abc::}}', '["a","b","c"]'],
  ['{{split::}}', '[""]'],
  ['{{split::::}}', '[]'],
  ['{{join::["a","b"]}}', 'a,b'],
  ['{{join::["a","b"]::}}', 'ab'],
  ['{{join::a§b}}', 'a,b'],
  ['{{join::[]}}', ''],
  ['{{join::}}', ''],
  ['{{spread::}}', ''],
  ['{{trim::}}', ''],
  ['{{length::}}', '0'],
  ['{{lower::}}', ''],
  ['{{upper::}}', ''],
  ['{{capitalize::}}', ''],
  ['{{iserror::}}', '0'],
  ['{{reverse}}', ''],
  ['{{reverse::}}', ''],
  ['{{replace:abc:b}}', 'aundefinedc'],
  ['{{ STARTS_WITH :abc}}', '0'],
  ['{{split::abc::b::ignored}}', '["a","c"]'],
  ['{{length::{{trim}}}}', '8'],
  ['{{#when::{{startswith::abc}}}}yes{{:else}}no{{/when}}', 'no'],
  ['{{#when::{{startswith::abc::}}}}yes{{:else}}no{{/when}}', 'yes'],
])('%s preserves positional argument semantics', (template, expected) => {
  expect(parse(template)).toBe(expected);
});

test.each(['startswith', 'endswith', 'contains'])('%s coerces only a missing needle', name => {
  expect(parse(`{{${name}::abc}}`)).toBe('0');
  expect(parse(`{{${name}::undefined}}`)).toBe('1');
  expect(parse(`{{${name}::abc::}}`)).toBe('1');
  expect(parse(`{{${name}::}}`)).toBe('0');
  expect(parse(`{{${name}::::}}`)).toBe('1');
});
