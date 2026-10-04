import { afterEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros';
import { transformPresetTemplate } from '../../src/core/preset/risup-translator';

const previous = (globalThis as any).spindle;
afterEach(() => { (globalThis as any).spindle = previous; });

test('translated preset booleans use Risu numeric strings and argument rules', async () => {
  const handlers = new Map<string, (context: unknown) => unknown>();
  (globalThis as any).spindle = { registerMacro: (macro: { name: string; handler: (context: unknown) => unknown }) => handlers.set(macro.name, macro.handler) };
  registerSpindleMacros();
  for (const [name, args, expected] of [
    ['equal', ['a', 'a'], '1'], ['equal', ['a', 'b'], '0'],
    ['notequal', ['a', 'b'], '1'], ['not_equal', ['a', 'a'], '0'],
    ['not', ['true'], '1'], ['not', [' 1'], '1'], ['not', ['1'], '0'],
    ['or', ['0', '0', '1'], '0'], ['and', ['1', '1', '0'], '1'],
    ['any', ['["0","1"]'], '1'], ['any', ['[0,1]'], '0'], ['any', ['0', '1'], '1'],
  ] as const) {
    const source = `{{${name}::${args.join('::')}}}`;
    const translatedName = transformPresetTemplate(source).slice(2).split('::')[0]!;
    expect(handlers.has(translatedName)).toBe(true);
    expect(await handlers.get(translatedName)!({ args })).toBe(expected);
  }
});
