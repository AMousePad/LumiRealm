import { afterEach, expect, spyOn, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, setDisplaySnapshot } from '../../src/display/snapshot.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';
import { snapshot, context } from '../helpers/display-lua-fixture.js';
import { frontendRuntime } from '../helpers/frontend-runtime.js';

const rule = (out: string, find = 'TOKEN', flag = 'g') => mapRegex([
  { in: find, out, flag, ableFlag: true, type: 'editdisplay', comment: 'Synthetic' },
], { characterId: context.characterId }).rows;
const state = snapshot('');
const apply = (resolver: ReturnType<typeof createDisplayResolver>, scripts: readonly FeRegexScript[], content = 'TOKEN', ctx = context) =>
  resolver.applyScripts({ content, scripts: [...scripts], context: ctx });
afterEach(() => clearDisplaySnapshot(context.chatId));

const native = (out: string, find = 'TOKEN', scope: FeRegexScript['scope'] = 'global'): FeRegexScript => ({
  ...rule(out, find)[0]!, metadata: {}, scope,
});

test.each(['global', 'chat'] as const)('native %s rules do not disable Risu history retention', async scope => {
  const resolver = createDisplayResolver();
  const scripts = [...rule('{{lastmessage}}'), native('unused', 'ABSENT', scope)];
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('Hello');
  setDisplaySnapshot({ ...state, chat: { ...state.chat, messages: [{ role: 'assistant', content: 'Pending', createdAt: 0 }] } });
  expect((await apply(resolver, scripts))?.content).toBe('Hello');
  resolver.resetScriptCache();
  expect((await apply(resolver, scripts))?.content).toBe('Pending');
});

test('native output remains live after a Risu cache hit', async () => {
  const resolver = createDisplayResolver();
  const scripts = [...rule('{{lastmessage}}'), native('$& {{getchatvar::x}}', 'Hello', 'chat')];
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('Hello 2');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: '3' } },
    chat: { ...state.chat, messages: [{ role: 'assistant', content: 'Pending', createdAt: 0 }] } });
  expect((await apply(resolver, scripts))?.content).toBe('Hello 3');
});

test('native input changes invalidate the following Risu result', async () => {
  const resolver = createDisplayResolver();
  const scripts = [native('{{getchatvar::x}}'), ...rule('done', '^2$')];
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('done');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: '3' } } });
  expect((await apply(resolver, scripts))?.content).toBe('3');
});

test('interleaved native rules share local variables and preserve execution order', async () => {
  const resolver = createDisplayResolver();
  const scripts = [native('{{setvar::temporary::{{getchatvar::x}}}}$&', '^TOKEN$', 'character'),
    ...rule('{{lastmessage}}'), native('$& {{getvar::temporary}}', 'Hello', 'character')];
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('Hello 2');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: '3' } },
    chat: { ...state.chat, messages: [{ role: 'assistant', content: 'Pending', createdAt: 0 }] } });
  expect((await apply(resolver, scripts))?.content).toBe('Hello 3');
});

test('multiple Risu batches retain results independently around native rows', async () => {
  const resolver = createDisplayResolver();
  const scripts = [...rule('{{lastmessage}}'), native('$& SUFFIX', 'Hello', 'character'),
    ...rule('{{getvar::x}}', 'SUFFIX')];
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('Hello 2');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: '3' } },
    chat: { ...state.chat, messages: [{ role: 'assistant', content: 'Pending', createdAt: 0 }] } });
  const cached = await apply(resolver, scripts);
  expect(cached?.content).toBe('Hello 2');
  expect(cached?.touchedVars).toContain('__msg__');
  expect(cached?.touchedVars).toContain('local:x');
  resolver.resetScriptCache();
  expect((await apply(resolver, scripts))?.content).toBe('Pending');
});

test('history refresh retains the regex result until a GUI reload', async () => {
  const resolver = createDisplayResolver();
  const scripts = rule('{{lastmessage}}');
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('Hello');
  setDisplaySnapshot({ ...state, chat: { ...state.chat, messages: [{ role: 'assistant', content: 'Pending response', createdAt: 0 }] } });
  expect((await apply(resolver, scripts))?.content).toBe('Hello');
  resolver.resetScriptCache();
  expect((await apply(resolver, scripts))?.content).toBe('Pending response');
});

test('post-CBS input, rule edits, and evaluated CBS find changes miss the cache', async () => {
  const resolver = createDisplayResolver();
  setDisplaySnapshot(state);
  const scripts = rule('{{getvar::x}}', '{{getvar::pattern}}', 'g<cbs>');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: 'one', pattern: 'TOKEN' } } });
  expect((await apply(resolver, scripts))?.content).toBe('one');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: 'two', pattern: 'ABSENT' } } });
  expect((await apply(resolver, scripts))?.content).toBe('TOKEN');
  expect((await apply(resolver, rule('edited')))?.content).toBe('edited');
  expect((await apply(resolver, rule('edited'), 'TOKEN!'))?.content).toBe('edited!');
});

test('hits preserve dependencies and skip random replacement evaluation', async () => {
  const resolver = createDisplayResolver();
  setDisplaySnapshot(state);
  const random = spyOn(Math, 'random').mockReturnValue(0);
  try {
    const scripts = rule('{{getvar::x}} {{random::red::blue}}');
    const first = await apply(resolver, scripts);
    const calls = random.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(await apply(resolver, scripts)).toEqual(first);
    expect(random.mock.calls.length).toBe(calls);
    resolver.resetScriptCache();
    await apply(resolver, scripts);
    expect(random.mock.calls.length).toBeGreaterThan(calls);
  } finally { random.mockRestore(); }
});

test('empty results are cache misses as in processScriptFull', async () => {
  const resolver = createDisplayResolver();
  const scripts = rule('{{getvar::value}}');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { value: '' } } });
  expect((await apply(resolver, scripts))?.content).toBe('');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { value: 'new' } } });
  expect((await apply(resolver, scripts))?.content).toBe('new');
});

test('native rules keep their live variable semantics', async () => {
  const resolver = createDisplayResolver();
  const scripts = rule('{{getchatvar::x}}').map(row => ({ ...row, metadata: {} }));
  setDisplaySnapshot(state);
  expect((await apply(resolver, scripts))?.content).toBe('2');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: '3' } } });
  expect((await apply(resolver, scripts))?.content).toBe('3');
});

test('runtime GUI reload resets scripts while chat reload retains them', async () => {
  const resolver = createDisplayResolver();
  const resets: boolean[] = [];
  const fixture = await frontendRuntime(`
    function onButtonClick(id, action)
      setChatVar(id, 'x', '3')
      if action == 'gui' then reloadDisplay(id) else reloadChat(id, 0) end
    end
  `, (_chat, _keys, reset) => { resets.push(Boolean(reset)); if (reset) resolver.resetScriptCache(); });
  try {
    const scripts = rule('{{getvar::x}}');
    expect((await apply(resolver, scripts))?.content).toBe('2');
    resets.length = 0;
    await fixture.call({ kind: 'button', value: 'chat' });
    expect(resets).not.toContain(true);
    expect((await apply(resolver, scripts))?.content).toBe('2');
    await fixture.call({ kind: 'button', value: 'gui' });
    expect(resets).toContain(true);
    expect((await apply(resolver, scripts))?.content).toBe('3');
  } finally { fixture.runtime.dispose(); }
});

test('display Lua and caller CBS still run before a regex cache hit', async () => {
  const resolver = createDisplayResolver();
  const fixture = await frontendRuntime(`
    listenEdit('editDisplay', function(id, data)
      setChatVar(id, 'runs', tostring(tonumber(getChatVar(id, 'runs')) + 1))
      return data
    end)
  `);
  fixture.runtime.writeback(context.chatId, { runs: '0' });
  try {
    const scripts = rule('{{getvar::runs}}');
    const render = async () => {
      const body = await resolver.resolveBody({ content: 'TOKEN', context });
      return apply(resolver, scripts, body!.content);
    };
    expect((await render())?.content).toBe('1');
    expect((await render())?.content).toBe('1');
    const body = await resolver.resolveBody({ content: '{{getvar::runs}}', context });
    expect(body?.content).toBe('2');
  } finally { fixture.runtime.dispose(); }
});

test.each(['output', 'manual'] as const)('completed %s trigger variable writes reset the regex cache once', async binding => {
  const resolver = createDisplayResolver();
  const resets: boolean[] = [];
  const config = { ...state, luaTriggers: [{ luaCode: '', source: {
    type: binding, comment: 'change', conditions: [], effect: [
      { type: 'v2SetVar', var: 'x', value: '3', valueType: 'value', operator: '=', indent: 0 },
    ],
  } }] };
  const fixture = await frontendRuntime(config, (_chat, _keys, reset) => {
    if (reset) { resets.push(true); resolver.resetScriptCache(); }
  });
  try {
    const scripts = rule('{{getvar::x}}');
    expect((await apply(resolver, scripts))?.content).toBe('2');
    resets.length = 0;
    const operation = binding === 'output' ? { kind: 'binding', binding } as const : { kind: 'manual', name: 'change' } as const;
    await fixture.call(operation);
    expect(resets).toHaveLength(1);
    expect((await apply(resolver, scripts))?.content).toBe('3');
    resets.length = 0;
    await fixture.call(operation);
    expect(resets).toHaveLength(0);
  } finally { fixture.runtime.dispose(); }
});

test('FIFO capacity and empty misses match the bounded Risu cache', async () => {
  const resolver = createDisplayResolver();
  const scripts = rule('{{getvar::x}}', '^.*$');
  setDisplaySnapshot(state);
  for (let index = 0; index < 1000; index++) await apply(resolver, scripts, String(index));
  await apply(resolver, scripts, '0');
  await apply(resolver, scripts, '1000');
  setDisplaySnapshot({ ...state, vars: { ...state.vars, local: { x: 'new' } } });
  expect((await apply(resolver, scripts, '1'))?.content).toBe('2');
  expect((await apply(resolver, scripts, '0'))?.content).toBe('new');
});

test('placement and depth gates change applicability without dropping history dependencies', async () => {
  const resolver = createDisplayResolver();
  setDisplaySnapshot(state);
  const scripts = rule('{{lastmessage}}').map(row => ({ ...row, max_depth: 0 }));
  const first = await apply(resolver, scripts);
  expect(first?.touchedVars).toContain('__msg__');
  expect((await apply(resolver, scripts, 'TOKEN', { ...context, depth: 1 }))?.content).toBe('TOKEN');
  expect((await apply(resolver, scripts))?.touchedVars).toContain('__msg__');
});

test('module regex actions execute on misses and GUI reloads, not on hits', async () => {
  const effects: unknown[] = [];
  const resolver = createDisplayResolver(undefined, effect => { effects.push(effect); });
  setDisplaySnapshot({ ...state,
    character: { ...state.character, emotionImages: { Joy: { imageIds: ['joy'] } } },
    atActions: [{ action: 'emo', directAction: 'emo', findRegex: 'TOKEN', flag: 'g', out: '@@emo Joy',
      phase: 'editdisplay', order: 0, sourceIndex: 0, sourceRowIndex: 0,
      sourceOrigin: 'module:module', liveScriptId: 'action' }],
  });
  const scripts = rule('unchanged').map(row => ({ ...row, id: 'action', replace_string: '@@emo Joy',
    metadata: { _risu: { module_id: 'module', phase: 'editdisplay', source_index: 0, source_row_index: 0 } },
  }));
  expect((await apply(resolver, scripts))?.content).toBe('TOKEN');
  expect(effects).toHaveLength(1);
  await apply(resolver, scripts);
  expect(effects).toHaveLength(1);
  resolver.resetScriptCache();
  await apply(resolver, scripts);
  expect(effects).toHaveLength(2);
});

test('aborted triggers preserve their writes without issuing a completion GUI reload', async () => {
  const resets: boolean[] = [];
  const fixture = await frontendRuntime({ ...state, luaTriggers: [{ luaCode: '', source: {
    type: 'output', comment: 'abort', conditions: [], effect: [
      { type: 'v2SetVar', var: 'x', value: '3', valueType: 'value', operator: '=', indent: 0 },
      { type: 'v2MakeArrayVar', var: '[]', indent: 0 },
    ],
  } }] }, (_chat, _keys, reset) => { if (reset) resets.push(true); });
  try {
    resets.length = 0;
    await fixture.call({ kind: 'binding', binding: 'output' });
    expect(resets).toHaveLength(0);
    expect((await apply(createDisplayResolver(), rule('{{getvar::x}}')))?.content).toBe('3');
  } finally { fixture.runtime.dispose(); }
});

test('the resolver opts into finalization without display scripts', () => {
  expect(createDisplayResolver().finalizeWithoutScripts).toBe(true);
});
