import { afterEach, beforeEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros';
import { transformPresetTemplate } from '../../src/core/preset/risup-translator';

type Handler = (context: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
let handlers: Map<string, Handler>;

beforeEach(() => {
  handlers = new Map();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (macro: { name: string; handler: Handler }) => handlers.set(macro.name, macro.handler),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  registerSpindleMacros();
});
afterEach(() => { (globalThis as { spindle?: unknown }).spindle = previous; });

test('Risu replace takes the source text first, unlike the host replace', async () => {
  const source = '{{replace::{{getglobalvar::toggle_a}}::null::0}}';
  expect(transformPresetTemplate(source)).toBe('{{risuReplace::{{risuGlobalVar::toggle_a}}::null::0}}');
  const replace = handlers.get('risuReplace')!;
  expect(await replace({ args: ['1', 'null', '0'] })).toBe('1');
  expect(await replace({ args: ['0', 'null', '0'] })).toBe('0');
  expect(await replace({ args: ['null', 'null', '0'] })).toBe('0');
});

test('Risu dice, pick and time macros replace the host macros of the same name', () => {
  for (const [source, target] of [
    ['{{roll::500}}', '{{risuRoll::500}}'], ['{{roll}}', '{{risuRoll}}'],
    ['{{random::a::b}}', '{{risuRandom::a::b}}'], ['{{random}}', '{{risuRandom}}'],
    ['{{time::YYYY}}', '{{risuTime::YYYY}}'], ['{{time}}', '{{risuTime}}'],
    ['{{Roll::500}}', '{{risuRoll::500}}'], ['{{Random::a::b}}', '{{risuRandom::a::b}}'],
    ['{{? {{roll::500}}<=8}}', '{{risuCalc::{{risuRoll::500}}<=8}}'],
    // Other macros that only share the prefix keep their own meaning.
    ['{{rollp::6}}', '{{rollp::6}}'], ['{{randomize}}', '{{randomize}}'], ['{{time_since}}', '{{time_since}}'],
  ]) {
    expect(transformPresetTemplate(source!)).toBe(target!);
  }
});

test('Risu roll treats a bare number as sides, which the host rejects and returns 0', async () => {
  const roll = (...args: string[]) => handlers.get('risuRoll')!({ args });
  const random = Math.random;
  try {
    Math.random = () => 0;
    expect(await roll('500')).toBe('1');
    expect(await roll('2d6')).toBe('2');
    expect(await roll('d6')).toBe('1');
    Math.random = () => 0.999;
    expect(await roll('500')).toBe('500');
    expect(await roll('2d6')).toBe('12');
    expect(await roll('0')).toBe('NaN');
    expect(await roll('abc')).toBe('NaN');
    expect(await roll()).toBe('1');
  } finally { Math.random = random; }
});

test('Risu random picks an argument, so two numbers are not a range', async () => {
  const pick = (...args: string[]) => handlers.get('risuRandom')!({ args });
  const random = Math.random;
  try {
    Math.random = () => 0.5;
    expect(await pick('1', '9')).toBe('9');
    expect(await pick('a,b,c')).toBe('b');
    expect(await pick('[1,2,3]')).toBe('2');
    expect(await pick()).toBe('0.5');
    Math.random = () => 0.999;
    expect(await pick('a', 'b', '')).toBe('');
  } finally { Math.random = random; }
});

test('Risu time is unpadded H:M:S when bare and honors a format, unlike the host UTC offset', async () => {
  const now = Date.now;
  try {
    Date.now = () => new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(await handlers.get('risuTime')!({ args: [] })).toBe('3:4:5');
    expect(await handlers.get('risuTime')!({ args: ['YYYY-MM-DD HH:mm'] })).toBe('2026-01-02 03:04');
    expect(await handlers.get('risuTime')!({ args: [''] })).toBe('');
  } finally { Date.now = now; }
});

test('Risu trim returns its trimmed argument', async () => {
  expect(transformPresetTemplate('{{trim::  a  }}')).toBe('{{risuTrim::  a  }}');
  // The host keeps its own bare {{trim}} marker.
  expect(transformPresetTemplate('{{trim}}')).toBe('{{trim}}');
  expect(await handlers.get('risuTrim')!({ args: ['  a; b  \n'] })).toBe('a; b');
});

test('Risu xordecrypt and its aliases decode text the host would otherwise leave encoded', async () => {
  for (const name of ['xordecrypt', 'xordecode', 'xord', 'XorDecrypt']) {
    expect(transformPresetTemplate(`{{${name}::l5qTk5A=}}`)).toBe('{{risuXorDecrypt::l5qTk5A=}}');
  }
  // The encoding direction is a separate macro.
  expect(transformPresetTemplate('{{xor::hello}}')).toBe('{{xor::hello}}');
  expect(await handlers.get('risuXorDecrypt')!({ args: ['l5qTk5A='] })).toBe('hello');
});

test('macros whose result changes per run are marked volatile for the host', () => {
  const volatile = new Map<string, unknown>();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (macro: { name: string; volatile?: unknown }) => volatile.set(macro.name, macro.volatile),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  registerSpindleMacros();
  for (const name of ['risuRoll', 'risuRandom', 'risuTime']) expect(volatile.get(name)).toBe(true);
  expect(volatile.get('risuLess')).toBe(false);
});

test('Risu all is the boolean form, not the host list iterator of the same name', async () => {
  expect(transformPresetTemplate('{{all::{{less::1::3}}::{{not_equal::1::null}}}}'))
    .toBe('{{risuAll::{{risuLess::1::3}}::{{risuNotEqual::1::null}}}}');
  expect(await handlers.get('risuAll')!({ args: ['1', '1'] })).toBe('1');
  expect(await handlers.get('risuAll')!({ args: ['1', '0'] })).toBe('0');
});

test('Risu comparison macros and their aliases reach the numeric handlers', () => {
  for (const [source, target] of [
    ['greater', 'risuGreater'], ['less', 'risuLess'],
    ['greaterequal', 'risuGreaterEqual'], ['greater_equal', 'risuGreaterEqual'],
    ['lessequal', 'risuLessEqual'], ['less_equal', 'risuLessEqual'],
  ]) {
    expect(transformPresetTemplate(`{{${source}::10::9}}`)).toBe(`{{${target}::10::9}}`);
  }
});

test('Risu comparisons are numeric and false when an operand is not a number', async () => {
  const compare = (name: string, ...args: string[]) => handlers.get(name)!({ args });
  for (const [name, below, same, above] of [
    ['risuGreater', '0', '0', '1'], ['risuLess', '1', '0', '0'],
    ['risuGreaterEqual', '0', '1', '1'], ['risuLessEqual', '1', '1', '0'],
  ] as const) {
    expect(await compare(name, '9', '10')).toBe(below);
    expect(await compare(name, '10', '10')).toBe(same);
    expect(await compare(name, '10', '9')).toBe(above);
    expect(await compare(name, 'x', '1')).toBe('0');
    expect(await compare(name, '1')).toBe('0');
  }
});
