import { afterEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros.js';
import { transformPresetTemplate } from '../../src/core/preset/risup-translator.js';

// Risu's #each reads its list with parseArray (a JSON array, else § separated)
// and the host loop splits a delimited string, so the translated loop must hand
// the host the items Risu iterates. The cases mirror Risu's own loop tests.

type MacroHandler = (ctx: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
afterEach(() => { (globalThis as { spindle?: unknown }).spindle = previous; });

test.each([
  ['{{array::a, b::c}} as v', 'a, b§c'],
  ['["a, b", "c"] v', 'a, b§c'],
  ['::keep [[1, 2], [3, 4]] as v', '[1,2]§[3,4]'],
  ['as [1, {"k":2}] as v', '1§{"k":2}'],
  ['a,b,c as v', 'a,b,c'],
  ['null as v', 'null'],
  ['[] as v', ''],
])('loops over the items Risu iterates for %s', async (header, list) => {
  const handlers = new Map<string, MacroHandler>();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (def: { name: string; handler: MacroHandler }) => handlers.set(def.name, def.handler),
  };
  registerSpindleMacros();
  const translated = transformPresetTemplate(`{{#each ${header}}}{{slot::v}}{{/}}`);
  const loop = /^\{\{#each::\{\{risuList::(.*)\}\}::v::§\}\}\{\{getvar::v\}\}\{\{\/each\}\}$/.exec(translated);
  expect(loop).not.toBeNull();
  // The host splits the list argument on `::` before the handler sees it.
  expect(await handlers.get('risuList')!({ args: loop![1]!.split('::') })).toBe(list);
});
