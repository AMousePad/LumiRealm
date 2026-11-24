import { afterEach, beforeEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros';
import { transformPresetTemplate, translateRisuPromptBlocks } from '../../src/core/preset/risup-translator';

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

// The host hands an extension macro its resolved arguments and evaluated body.
function when(args: string[], body: string, env: { toggles?: Record<string, string>; chat?: Record<string, string> } = {}) {
  return Promise.resolve(handlers.get('risuWhen')!({
    args, isScoped: true, body,
    env: { variables: { global: {}, local: {}, chat: env.chat ?? {} }, extra: { promptVariables: env.toggles ?? {} } },
  }));
}

test('translated when header reaches the macro as the Risu statement', () => {
  expect(transformPresetTemplate('{{#when::keep::{{getglobalvar::toggle_a}}::is::1}}x{{/}}'))
    .toBe('{{#risuWhen::when::keep::{{risuGlobalVar::toggle_a}}::is::1}}x{{/risuWhen}}');
  expect(transformPresetTemplate('{{#when {{? 1=1}}}}x{{/when}}'))
    .toBe('{{#risuWhen::when {{risuCalc::1=1}}}}x{{/risuWhen}}');
});

test('a block inside a macro argument gets a closer the host can pair', () => {
  expect(transformPresetTemplate('{{length::{{#when::0}}a{{:else}}b{{/}}}}'))
    .toBe('{{risuLength::{{#risuWhen::when::0}}a{{:else}}b{{/risuWhen}}}}');
  expect(transformPresetTemplate('{{#if {{equal::{{#when::0}}a{{/}}::b}}}}OK{{/}}'))
    .toBe('{{#if {{risuEqual::{{#risuWhen::when::0}}a{{/risuWhen}}::b}}}}OK{{/if}}');
  expect(transformPresetTemplate('{{#when::1}}{{#if 1}}a{{/}}{{length::{{#when::0}}b{{/}}}}c{{/}}'))
    .toBe('{{#risuWhen::when::1}}{{#if 1}}a{{/if}}{{risuLength::{{#risuWhen::when::0}}b{{/risuWhen}}}}c{{/risuWhen}}');
});

test('an inline else still splits when a multi-line slot value fills its block', async () => {
  const { blocks } = translateRisuPromptBlocks([
    { type: 'authornote', name: 'note', innerFormat: 'before\n{{#when::1}}{{slot}}{{:else}}alt{{/}}' },
  ], []);
  expect(blocks[0]!.content).toBe('before\n{{#risuWhen::when::1}}{{authornote}}\n{{:else}}\nalt{{/risuWhen}}');
  expect(await when(['when', '1'], 'two\nlines\n{{::else}}\nalt')).toBe('two\nlines');
  expect(await when(['when', '0'], 'two\nlines\n{{::else}}\nalt')).toBe('alt');
});

test('a slot in either branch is filled because the taken branch is unknown at import', () => {
  const { blocks } = translateRisuPromptBlocks([
    { type: 'persona', name: 'p', innerFormat: '{{#when::0}}<a>{{slot}}</a>{{:else}}<b>{{slot}}</b>{{/}}' },
  ], []);
  expect(blocks[0]!.content).toBe('{{#risuWhen::when::0}}<a>{{persona}}</a>\n{{:else}}\n<b>{{persona}}</b>{{/risuWhen}}');
});

test('only the branch selected by the condition is kept', async () => {
  expect(await when(['when', 'keep', '1', 'is', '1'], 'x')).toBe('x');
  expect(await when(['when', 'keep', '0', 'is', '1'], 'x')).toBe('');
  expect(await when(['when', 'keep', '0', 'isnot', '1'], 'x')).toBe('x');
  expect(await when(['when', '2', '>', '1'], 'x')).toBe('x');
  expect(await when(['when', 'not', '1'], 'x')).toBe('');
  expect(await when(['when 1'], 'x')).toBe('x');
  expect(await when(['when 0'], 'x')).toBe('');
});

test('toggle and variable operators read the effective stores', async () => {
  const toggles = { toggle_a: '1', toggle_b: '2' };
  expect(await when(['when', 'toggle', 'a'], 'x', { toggles })).toBe('x');
  expect(await when(['when', 'b', 'tis', '2'], 'x', { toggles })).toBe('x');
  expect(await when(['when', 'b', 'tisnot', '2'], 'x', { toggles })).toBe('');
  expect(await when(['when', 'var', 'v'], 'x', { chat: { v: '1' } })).toBe('x');
  expect(await when(['when', 'var', 'v'], 'x', { chat: { v: '0' } })).toBe('');
});

// The host parses {{:else}} as a nameless macro and hands it back as {{::else}}.
test('else selects the other branch and its line is removed', async () => {
  for (const separator of ['{{:else}}', '{{::else}}']) {
    expect(await when(['when', '1'], `a${separator}b`)).toBe('a');
    expect(await when(['when', '0'], `a${separator}b`)).toBe('b');
    expect(await when(['when', 'keep', '1'], `a\n${separator}\nb`)).toBe('a');
    expect(await when(['when', 'keep', '0'], `a\n${separator}\nb`)).toBe('b');
  }
});

test('blank edge lines are trimmed unless the block says keep', async () => {
  expect(await when(['when', '1'], '\n  a\n\n')).toBe('  a');
  expect(await when(['when', 'keep', '1'], '\n  a\n\n')).toBe('\n  a\n\n');
});

test('an unclosed block fails loudly', async () => {
  await expect(Promise.resolve(handlers.get('risuWhen')!({ args: ['when', '1'], isScoped: false }))).rejects.toThrow('no closing');
});
