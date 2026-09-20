// Expectations come from RisuAI e565563a288ebe4c65b6099a1645ba477d1c84b4.
// Source references below are relative to https://github.com/kwaroran/RisuAI/tree/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts.
export interface CbsRisuCase {
  readonly name: string;
  readonly template: string;
  readonly expected: string;
  readonly source: string;
  readonly mode?: 'display' | 'rmVar';
  readonly knownFailure?: boolean;
}

export const cbsRisuCases: readonly CbsRisuCase[] = [
  ...['dict', 'd', 'makedict', 'makeobject', 'object', 'o'].map((alias) => ({
    name: `${alias} accepts key=value pairs`,
    template: `{{${alias}::a=A::b=B}}`,
    expected: '{"a":"A","b":"B"}',
    source: 'cbs.ts:1305 registerCBS(makedict)',
  })),
  { name: 'dictionary splits at the first equals sign', template: '{{dict::a=A=B}}', expected: '{"a":"A=B"}', source: 'cbs.ts:1305 registerCBS(makedict)' },
  { name: 'dictionary ignores arguments without equals signs', template: '{{dict::ignored::a=A::a=B}}', expected: '{"a":"B"}', source: 'cbs.ts:1305 registerCBS(makedict)' },
  { name: 'one parser pass leaves a returned macro literal', template: '{{getvar::nested}}', expected: '{{char}}', source: 'parser/parser.svelte.ts:1805 risuChatParser', knownFailure: true },
  { name: 'one parser pass leaves a returned variable read literal', template: '{{getvar::nested2}}', expected: '{{getvar::nested}}', source: 'parser/parser.svelte.ts:1805 risuChatParser', knownFailure: true },
  { name: 'returned macro text does not execute temporary writes', template: '{{getvar::nestedWrite}}|{{tempvar::side}}', expected: '{{settempvar::side::changed}}|', source: 'parser/parser.svelte.ts:1805 risuChatParser', knownFailure: true },
  { name: 'last character alias searches before the current message', template: '{{lastcharmessage}}', expected: 'Greeting', source: 'cbs.ts:195 registerCBS(previouscharchat)', mode: 'display' },
  { name: 'last user alias is empty without a message index', template: '{{lastusermessage}}', expected: '', source: 'cbs.ts:214 registerCBS(previoususerchat)' },
  { name: 'formatted time honors the format and timestamp', template: '{{time::YYYY::1700000000000}}', expected: '1970', source: 'cbs.ts:1587 registerCBS(time); parser/parser.svelte.ts:1102 dateTimeFormat', knownFailure: true },
  { name: 'formatted date preserves Risu timestamp scaling', template: '{{date::YYYY::1700000000000}}', expected: '1970', source: 'cbs.ts:1565 registerCBS(date); parser/parser.svelte.ts:1102 dateTimeFormat', knownFailure: true },
  { name: 'dictionary element accepts an array index', template: '{{dictelement::["a","b"]::1}}', expected: 'b', source: 'cbs.ts:1190 registerCBS(dictelement)' },
  { name: 'splice without replacement serializes undefined as null', template: '{{arraysplice::["a","b"]::0::1}}', expected: '[null,"b"]', source: 'cbs.ts:1271 registerCBS(arraysplice)' },
  { name: 'assert without a value serializes undefined as null', template: '{{arrayassert::["a"]::3}}', expected: '["a",null,null,null]', source: 'cbs.ts:1282 registerCBS(arrayassert)' },
  { name: 'function empty return remains empty', template: '{{#func f}}x{{return::}}y{{/func}}{{call::f}}', expected: '', source: 'cbs.ts:779 registerCBS(return); parser/parser.svelte.ts:1816 risuChatParser', knownFailure: true },
  { name: 'history greeting has no invented timestamp', template: '{{history}}', expected: JSON.stringify([JSON.stringify({ role: 'char', data: 'Greeting' }), JSON.stringify({ role: 'user', data: 'Hello', time: 1700000000000 }), JSON.stringify({ role: 'char', data: 'Welcome', time: 1700000005000 })]), source: 'cbs.ts:1513 registerCBS(history)' },
  { name: 'counted cbr preserves the registered callback behavior', template: '{{cbr::2}}', expected: 'cbr::2cbr::2', source: 'cbs.ts:1386 registerCBS(cbr)' },
  { name: 'unknown ignore block retains delimiters and parses its body', template: '{{#ignore}}A {{char}} B{{/ignore}}', expected: '{{#ignore}}A Character B{{/ignore}}', source: 'parser/parser.svelte.ts:1188 blockStartMatcher; :1805 risuChatParser', knownFailure: true },
  { name: 'top-level declare stays literal without a caller variable map', template: '{{declare::x}}', expected: '{{declare::x}}', source: 'cbs.ts:2249 registerCBS(declare); parser/parser.svelte.ts:1071 matcher', knownFailure: true },
  { name: 'missing calc argument preserves the original macro', template: '{{calc}}', expected: '{{calc}}', source: 'cbs.ts:802 registerCBS(calc); parser/parser.svelte.ts:1071 matcher', knownFailure: true },
  { name: 'missing startswith arguments preserve the original macro', template: '{{startswith}}', expected: '{{startswith}}', source: 'cbs.ts:985 registerCBS(startswith); parser/parser.svelte.ts:1071 matcher' },
  { name: 'inactive setvar preserves the exact supplied syntax', template: '{{setvar}}', expected: '{{setvar}}', source: 'cbs.ts:825 registerCBS(setvar); parser/parser.svelte.ts:1805 risuChatParser' },
  { name: 'nested source arguments evaluate before their parent', template: '{{upper::{{char}}}}', expected: 'CHARACTER', source: 'parser/parser.svelte.ts:1683 risuChatParser' },
  { name: 'canonical previous character respects the current index', template: '{{previouscharchat}}', expected: 'Greeting', source: 'cbs.ts:195 registerCBS(previouscharchat)', mode: 'display' },
  { name: 'canonical previous user is empty without an index', template: '{{previoususerchat}}', expected: '', source: 'cbs.ts:214 registerCBS(previoususerchat)' },
  { name: 'splice with an explicit replacement retains that value', template: '{{arraysplice::["a","b"]::0::1::x}}', expected: '["x","b"]', source: 'cbs.ts:1271 registerCBS(arraysplice)' },
  { name: 'assert with an explicit replacement fills sparse gaps', template: '{{arrayassert::["a"]::3::x}}', expected: '["a",null,null,"x"]', source: 'cbs.ts:1282 registerCBS(arrayassert)' },
  { name: 'object assertion replaces a falsy value', template: '{{objectassert::{"a":false}::a::V}}', expected: '{"a":"V"}', source: 'cbs.ts:1201 registerCBS(objectassert)' },
  { name: 'function nonempty return exits immediately', template: '{{#func f}}x{{return::ok}}y{{/func}}{{call::f}}', expected: 'ok', source: 'cbs.ts:779 registerCBS(return); parser/parser.svelte.ts:1816 risuChatParser' },
  { name: 'uncounted cbr is one escaped newline', template: '{{cbr}}', expected: '\\n', source: 'cbs.ts:1386 registerCBS(cbr)' },
  { name: 'unknown ordinary block remains literal', template: '{{#unknown_block}}A {{char}} B{{/unknown_block}}', expected: '{{#unknown_block}}A Character B{{/unknown_block}}', source: 'parser/parser.svelte.ts:1188 blockStartMatcher; :1805 risuChatParser' },
  { name: 'display rmVar hides a write without executing it', template: '{{setvar::x::9}}|{{getvar::x}}', expected: '|2', source: 'cbs.ts:825 registerCBS(setvar)', mode: 'rmVar' },
  { name: 'plain parser leaves a gated variable write literal', template: '{{setvar::x::9}}|{{getvar::x}}', expected: '{{setvar::x::9}}|2', source: 'cbs.ts:825 registerCBS(setvar)' },
  { name: 'temporary variables are shared within the parser pass', template: '{{settempvar::q::VALUE}}{{tempvar::q}}', expected: 'VALUE', source: 'cbs.ts:765 registerCBS(settempvar)' },
  { name: 'each expands slots before parsing its body', template: '{{#each ["a","b"] as v}}[{{slot::v}}]{{/each}}', expected: '[a][b]', source: 'parser/parser.svelte.ts:1188 blockStartMatcher; :1751 risuChatParser' },
];
