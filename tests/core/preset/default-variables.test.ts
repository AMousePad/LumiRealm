import { afterEach, expect, test } from 'bun:test';
import { translateRisuPreset } from '../../../src/core/preset/risup-translator';
import { registerSpindleMacros } from '../../../src/interpreter/spindle-macros';
import { resetAllScriptstateDefaults, setActiveScriptstateDefaults } from '../../../src/interpreter/defaults-cache';

const saved = (globalThis as any).spindle;
afterEach(() => { (globalThis as any).spindle = saved; resetAllScriptstateDefaults(); });

function reader(defaults: string, chat: Record<string, string | null> = {}) {
  const handlers = new Map<string, (ctx: unknown) => unknown>();
  (globalThis as any).spindle = { registerMacro: (def: any) => handlers.set(def.name, def.handler) };
  registerSpindleMacros();
  const { preset } = translateRisuPreset({ templateDefaultVariables: defaults });
  const env = { chat: { id: 'chat' }, variables: { chat }, extra: { presetMetadata: preset.metadata } };
  return (name: string, arg: string) => handlers.get(name)!({ args: [arg], env });
}

test('imported preset defaults reach variable reads and calculations', async () => {
  const read = reader('x=7');
  expect(await read('risuChatVar', 'x')).toBe('7');
  expect(await read('risuCalc', '$x+1')).toBe('8');
});

test('chat values and character defaults precede preset defaults', async () => {
  setActiveScriptstateDefaults('chat', 'character', { x: '3' });
  expect(await reader('x=7')('risuChatVar', 'x')).toBe('3');
  expect(await reader('x=7', { x: '2' })('risuChatVar', 'x')).toBe('2');
  expect(await reader('x=7', { x: '' })('risuChatVar', 'x')).toBe('');
  expect(await reader('x=7', { x: null })('risuChatVar', 'x')).toBe('3');
});

test('preset defaults retain Risu parseKeyValue whitespace, duplicates and equals behavior', async () => {
  const read = reader('x=first\nx=second\nempty=\n spaced = value \npart=a=b\nconstructor=safe\n__proto__=literal\ncr=value\r');
  for (const [key, expected] of [['x', 'first'], ['empty', 'null'], [' spaced ', ' value '], ['part', 'a'], ['constructor', 'safe'], ['__proto__', 'literal'], ['cr', 'value\r'], ['missing', 'null']]) {
    expect(await read('risuChatVar', key!)).toBe(expected);
  }
});
