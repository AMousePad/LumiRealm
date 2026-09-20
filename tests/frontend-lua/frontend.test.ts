import { afterEach, expect, test, mock } from 'bun:test';
import { dirname, join } from 'node:path';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setupFrontendLua } from '../../src/frontend-lua/frontend.js';
import { snapshot, context } from '../helpers/display-lua-fixture.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { clearDisplaySnapshot, getDisplaySnapshot } from '../../src/display/snapshot.js';
import type { RuntimeServiceCall } from '../../src/frontend-lua/services.js';
import type { RuntimeStateDto } from '../../src/frontend-lua/state-contract.js';
import type { StateRevision } from '../../src/frontend-lua/ordered-state.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { withCurrentDisplayMessage } from '../../src/display/host-shim.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';

mock.module('../../src/display/_glue-wasm-b64.js', () => ({
  GLUE_WASM_DATA_URI: join(dirname(Bun.resolveSync('wasmoon', import.meta.dir)), 'glue.wasm'),
}));

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function fixture(code: string, configure?: (state: RuntimeStateDto) => void) {
  const config = snapshot(code);
  config.luaTriggers[0]!.source.effect[0] = { type: 'triggerlua', code };
  const state: RuntimeStateDto = {
    revision: { epoch: 'host', sequence: 1 }, chat: { id: config.chatId, metadata: { chat_variables: {} } },
    character: { id: config.characterId, name: config.charName, description: 'Description', first_mes: 'Greeting', world_book_ids: [] }, persona: null,
    messages: config.messagesHost.map((message, index) => ({ ...message, index_in_chat: index })), lore: [], globalVariables: {},
  };
  configure?.(state);
  const events = new Map<string, (value: unknown, metadata?: { stateRevision: StateRevision }) => void>();
  const calls: RuntimeServiceCall[] = [];
  const failures: unknown[] = [];
  const entered = Promise.withResolvers<void>();
  const resolver = createDisplayResolver();
  const refreshes: boolean[] = [];
  const invalidations: string[][] = [];
  let runtime!: ReturnType<typeof setupFrontendLua>;
  const ctx = {
    frontendSessionId: '0123456789abcdef0123456789abcdef',
    events: { on(name: string, handler: (value: unknown, metadata?: { stateRevision: StateRevision }) => void) { events.set(name, handler); return () => events.delete(name); } },
    sendToBackend(raw: unknown) {
      const call = structuredClone(raw) as RuntimeServiceCall;
      if (call.type !== 'lua_service') throw new Error('Unexpected Lua execution IPC for a local button');
      calls.push(call);
      queueMicrotask(() => {
        let value: unknown;
        if (call.request.kind === 'bootstrap') value = { snapshot: config, state, settings: DEFAULT_SETTINGS, compiled: [] };
        else if (call.request.kind === 'state.write' && call.request.command.kind === 'chat.variables') {
          state.chat.metadata.chat_variables = { ...state.chat.metadata.chat_variables as object, ...call.request.command.values };
          state.revision = { epoch: 'host', sequence: state.revision.sequence + 1 };
          value = { revision: state.revision, value: undefined, patch: { chat: state.chat } };
        } else throw new Error(`Unexpected state read or service: ${call.request.kind}`);
        runtime.receive(structuredClone({ type: 'lua_service_reply', requestId: call.requestId, ok: true, value }));
      });
    },
    ui: {}, display: { setExpression() {} },
  } as unknown as SpindleFrontendContext;
  runtime = setupFrontendLua(ctx, (_chatId, _keys, resetScripts) => {
    refreshes.push(!!resetScripts);
    invalidations.push(_keys);
    if (resetScripts) resolver.resetScriptCache();
    if (getDisplaySnapshot(config.chatId)?.vars.local.entered === '1') entered.resolve();
  }, error => failures.push(error));
  cleanups.push(() => { runtime.dispose(); clearDisplaySnapshot(config.chatId); });
  await runtime.snapshot(config);
  return { runtime, config, state, calls, events, failures, resolver, refreshes, invalidations, entered: entered.promise };
}

test('named Lua settings refresh cached regex labels after changed variables, without an explicit reload', async () => {
  const { runtime, config, calls, resolver, refreshes } = await fixture(`
    function selectMode(id)
      setState(id, 'mode', 0)
      setChatVar(id, 'label', 'Prompt')
    end
  `);
  const scripts = mapRegex([{ in: 'LABEL', out: '{{getvar::label}}', type: 'editdisplay', flag: 'g', ableFlag: true, comment: '' }], { characterId: config.characterId }).rows;
  const render = () => resolver.applyScripts({ content: 'LABEL', scripts: [...scripts], context });
  expect((await render())?.content).toBe('null');
  refreshes.length = 0;
  await runtime.manual(config.chatId, { kind: 'manual', name: 'selectMode' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.label).toBe('Prompt');
  expect((await render())?.content).toBe('Prompt');
  expect(refreshes.filter(Boolean)).toHaveLength(1);
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap', 'state.write']);

  refreshes.length = 0;
  await runtime.manual(config.chatId, { kind: 'manual', name: 'selectMode' });
  expect(refreshes.filter(Boolean)).toEqual([]);
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap', 'state.write']);
});

test('button Lua keeps the live-variable cache behavior of runLuaButtonTrigger', async () => {
  const { runtime, config, refreshes } = await fixture(`function onButtonClick(id) setChatVar(id,'label','changed') end`);
  refreshes.length = 0;
  await runtime.manual(config.chatId, { kind: 'button', value: 'select' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.label).toBe('changed');
  expect(refreshes.filter(Boolean)).toEqual([]);
});

test.each(['wi_state', 'input_draft', 'extension_data'])('host %s metadata retains rendered regex results across generation and deletion', async key => {
  const { config, calls, events, resolver, refreshes, failures } = await fixture('');
  const scripts = mapRegex([{ in: 'LABEL', out: '{{lastmessage}}', type: 'editdisplay', flag: 'g', ableFlag: true, comment: '' }], { characterId: config.characterId }).rows;
  const render = () => resolver.applyScripts({ content: 'LABEL', scripts: [...scripts], context });
  const send = (event: string, payload: unknown, sequence: number) => events.get(event)!(payload, { stateRevision: { epoch: 'host', sequence } });
  expect((await render())?.content).toBe('Hello');
  send('MESSAGE_SENT', { chatId: config.chatId, message: { id: 'answer', role: 'assistant', content: 'Response', index_in_chat: 2 } }, 2);
  expect((await render())?.content).toBe('Hello');
  refreshes.length = 0;
  send('CHAT_CHANGED', { chat: { id: config.chatId, metadata: { chat_variables: { changed: 'yes' }, [key]: { active: ['entry'] } } } }, 3);
  expect((await render())?.content).toBe('Hello');
  expect(getDisplaySnapshot(config.chatId)?.vars.local.changed).toBe('yes');
  expect(refreshes).toEqual([false]);
  send('MESSAGE_DELETED', { chatId: config.chatId, messageId: 'answer' }, 4);
  expect((await render())?.content).toBe('Hello');
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap']);
  expect(failures).toEqual([]);
});

test.each([
  { activeGreetingIndex: 1 },
  { authors_note: { content: 'New note', depth: 2, role: 'system' } },
])('display metadata still refreshes cached regex results: %j', async metadata => {
  const { config, events, resolver, refreshes } = await fixture('');
  const scripts = mapRegex([{ in: 'LABEL', out: '{{lastmessage}}', type: 'editdisplay', flag: 'g', ableFlag: true, comment: '' }], { characterId: config.characterId }).rows;
  const render = () => resolver.applyScripts({ content: 'LABEL', scripts: [...scripts], context });
  expect((await render())?.content).toBe('Hello');
  events.get('MESSAGE_SENT')!({ chatId: config.chatId, message: { id: 'answer', role: 'assistant', content: 'Response', index_in_chat: 2 } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  refreshes.length = 0;
  events.get('CHAT_CHANGED')!({ chat: { id: config.chatId, metadata: { chat_variables: {}, ...metadata } } }, { stateRevision: { epoch: 'host', sequence: 3 } });
  expect((await render())?.content).toBe('Response');
  expect(refreshes).toEqual([true]);
});

test.each(['folder', 'updated_at', 'tags'])('character %s bookkeeping preserves cached output while synchronizing state', async field => {
  const { config, state, calls, events, resolver, refreshes } = await fixture('');
  const scripts = mapRegex([{ in: 'LABEL', out: '{{lastmessage}}', type: 'editdisplay', flag: 'g', ableFlag: true, comment: '' }], { characterId: config.characterId }).rows;
  const render = () => resolver.applyScripts({ content: 'LABEL', scripts: [...scripts], context });
  expect((await render())?.content).toBe('Hello');
  events.get('MESSAGE_SENT')!({ chatId: config.chatId, message: { id: 'answer', role: 'assistant', content: 'Response', index_in_chat: 2 } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  const before = getDisplaySnapshot(config.chatId);
  refreshes.length = 0;
  events.get('CHARACTER_EDITED')!({ id: config.characterId, character: { ...state.character, [field]: field === 'tags' ? ['tag'] : 'changed' } }, { stateRevision: { epoch: 'host', sequence: 3 } });
  expect(getDisplaySnapshot(config.chatId)).toEqual(before);
  expect((await render())?.content).toBe('Hello');
  expect(refreshes).toEqual([]);
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap']);
});

test('persona bookkeeping does not refresh output but relevant character and persona edits do', async () => {
  const { config, state, events, refreshes } = await fixture('', state => { state.persona = { id: 'persona', name: 'User' }; });
  refreshes.length = 0;
  events.get('PERSONA_CHANGED')!({ id: 'persona', persona: { ...state.persona, updated_at: 2 } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  expect(refreshes).toEqual([]);
  events.get('CHARACTER_EDITED')!({ id: config.characterId, character: { ...state.character, personality: 'Changed', image_id: 'image' } }, { stateRevision: { epoch: 'host', sequence: 3 } });
  expect(getDisplaySnapshot(config.chatId)?.character).toMatchObject({ personality: 'Changed', imageId: 'image' });
  expect(refreshes).toEqual([true]);
  events.get('PERSONA_CHANGED')!({ id: 'persona', persona: { ...state.persona, description: 'Changed' } }, { stateRevision: { epoch: 'host', sequence: 4 } });
  expect(refreshes).toEqual([true, true]);
});

test('display configuration arrival refreshes changed Lua and its removal, but not equal or stale snapshots', async () => {
  const { runtime, config, resolver, refreshes, calls } = await fixture('');
  const render = () => resolver.resolveBody({ content: 'TEXT', context });
  expect((await render())?.content).toBe('TEXT');
  refreshes.length = 0;
  const code = `listenEdit('editDisplay', function(id,text) return text..' CHANGED' end)`;
  const changed = { ...config, configVersion: 3, luaTriggers: [{ source: luaSource(code), luaCode: code }] };
  await runtime.snapshot(changed);
  expect(refreshes).toEqual([true]);
  expect((await render())?.content).toBe('TEXT CHANGED');
  refreshes.length = 0;
  await runtime.snapshot(structuredClone({ ...changed, configVersion: 4 }));
  await runtime.snapshot({ ...config, configVersion: 2 });
  expect(refreshes).toEqual([]);
  expect((await render())?.content).toBe('TEXT CHANGED');
  await runtime.snapshot({ ...config, configVersion: 5, luaTriggers: [] });
  expect(refreshes).toEqual([true]);
  expect((await render())?.content).toBe('TEXT');
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap']);
});

test('display defaults and module configuration refresh cached replacements without resetting native state', async () => {
  const { runtime, config, events, resolver, refreshes } = await fixture('');
  const scripts = mapRegex([{ in: 'LABEL', out: '{{getvar::default_label}}', type: 'editdisplay', flag: 'g', ableFlag: true, comment: '' }], { characterId: config.characterId }).rows;
  const render = () => resolver.applyScripts({ content: 'LABEL', scripts: [...scripts], context });
  expect((await render())?.content).toBe('null');
  events.get('CHAT_CHANGED')!({ chat: { id: config.chatId, metadata: { chat_variables: { native: 'current' } } } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  refreshes.length = 0;
  const changed = { ...config, configVersion: 2, scriptstateDefaults: { default_label: 'Default' }, modulesByNamespace: { module: ['id'] } };
  await runtime.snapshot(changed);
  expect(refreshes).toEqual([true]);
  expect((await render())?.content).toBe('Default');
  expect(getDisplaySnapshot(config.chatId)?.vars.local.native).toBe('current');
  refreshes.length = 0;
  await runtime.snapshot(structuredClone({ ...changed, configVersion: 3 }));
  expect(refreshes).toEqual([]);
});

test('saved drawer globals reach CBS and Lua on open, change and deletion without state reads', async () => {
  const { runtime, config, state, events, resolver, refreshes, invalidations, calls } = await fixture(`
    function readToggle(id) setChatVar(id,'seen',getGlobalVar(id,'toggle_mode')) end
  `, state => {
    state.chat.metadata.macro_variables = { global: { toggle_mode: '0' } };
    state.globalVariables = { toggle_mode: 'unrelated account value' };
  });
  const read = () => resolver.resolveBody({ content: '{{getglobalvar::toggle_mode}}', context });
  expect((await read())?.content).toBe('0');
  for (const [sequence, global, expected] of [[2, { toggle_mode: '1' }, '1'], [4, {}, 'null']] as const) {
    refreshes.length = 0; invalidations.length = 0;
    state.chat.metadata.macro_variables = { global };
    state.revision = { epoch: 'host', sequence };
    events.get('CHAT_CHANGED')!({ chat: structuredClone(state.chat) }, { stateRevision: state.revision });
    expect((await read())?.content).toBe(expected);
    expect(refreshes).toEqual([false]);
    expect(invalidations).toEqual([['global:toggle_mode']]);
    await runtime.snapshot({ ...config, configVersion: sequence, vars: { ...config.vars, global: { toggle_mode: 'stale' } } });
    expect((await read())?.content).toBe(expected);
    await runtime.manual(config.chatId, { kind: 'manual', name: 'readToggle' });
    expect(getDisplaySnapshot(config.chatId)?.vars.local.seen).toBe(expected);
  }
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap', 'state.write', 'state.write']);
});

async function triggerFixture(sources: TriggerScript[]) {
  const f = await fixture('');
  await f.runtime.snapshot({ ...f.config, luaTriggers: sources.map(source => ({ source,
    luaCode: source.effect[0]?.type === 'triggerlua' ? String(source.effect[0].code) : '',
  })) });
  f.refreshes.length = 0;
  return f;
}

const luaSource = (code: string, comment = 'script'): TriggerScript => ({ type: 'start', comment, conditions: [], effect: [{ type: 'triggerlua', code }] });
const namedSource = (comment: string, effect: TriggerScript['effect']): TriggerScript => ({ type: 'display', comment, conditions: [], effect });

test('named dispatch preserves interleaved Lua and matching comment order across scripts', async () => {
  const { runtime, config, refreshes } = await triggerFixture([
    namedSource('select', [{ type: 'setvar', var: 'order', value: '1', operator: '=' }]),
    luaSource(`function select(id) if getChatVar(id,'order') ~= '1' then error('wrong order') end setChatVar(id,'order','2') end`, 'first script'),
    namedSource('select', [{ type: 'setvar', var: 'order', value: '3', operator: '=' }]),
    luaSource(`function select(id) if getChatVar(id,'order') ~= '3' then error('wrong order') end setChatVar(id,'order','4') end`, 'second script'),
  ]);
  await runtime.manual(config.chatId, { kind: 'manual', name: 'select' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.order).toBe('4');
  expect(refreshes.filter(Boolean)).toHaveLength(1);
});

test.each(['runtrigger', 'v2RunTrigger'])('%s resolves Lua functions absent from trigger comments', async type => {
  const { runtime, config, refreshes } = await triggerFixture([
    namedSource('outer', [type === 'runtrigger' ? { type, value: 'callback' } : { type, target: 'callback', indent: 0 }]),
    luaSource(`function callback(id) setChatVar(id,'nested','called') end`, 'unrelated comment'),
  ]);
  await runtime.manual(config.chatId, { kind: 'manual', name: 'outer' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.nested).toBe('called');
  expect(refreshes.filter(Boolean)).toHaveLength(1);
});

test.each(['start', 'input', 'output'] as const)('manual-declared Lua still receives the %s binding', async binding => {
  const entry = { start: 'onStart', input: 'onInput', output: 'onOutput' }[binding];
  const { runtime, config, refreshes } = await triggerFixture([
    { ...luaSource(`function ${entry}(id) setChatVar(id,'binding','${binding}') end`), type: 'manual' },
    namedSource('unrelated', [{ type: 'setvar', var: 'wrong', value: 'called', operator: '=' }]),
  ]);
  await runtime.manual(config.chatId, { kind: 'binding', binding });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.binding).toBe(binding);
  expect(getDisplaySnapshot(config.chatId)?.vars.local.wrong).toBeUndefined();
  expect(refreshes.filter(Boolean)).toHaveLength(1);
});

test('a later Lua effect uses the invoked name and shares the declarative frame', async () => {
  const { runtime, config } = await triggerFixture([
    namedSource('select', [{ type: 'setvar', var: 'value', value: 'before', operator: '=' },
      { type: 'triggerlua', code: `function select(id) setChatVar(id,'value',getChatVar(id,'value')..':after') end` }]),
  ]);
  await runtime.manual(config.chatId, { kind: 'manual', name: 'select' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.value).toBe('before:after');
});

test('missing named functions do not call the generic button handler or refresh', async () => {
  const { runtime, config, refreshes } = await triggerFixture([
    luaSource(`function onButtonClick(id) setChatVar(id,'wrong','called') end`),
  ]);
  await runtime.manual(config.chatId, { kind: 'manual', name: 'absent' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.wrong).toBeUndefined();
  expect(refreshes.filter(Boolean)).toEqual([]);
});

test.each(['input', 'output', 'start'])('named dispatch preserves the reserved %s Lua mode', async mode => {
  const entry = { input: 'onInput', output: 'onOutput', start: 'onStart' }[mode];
  const { runtime, config } = await triggerFixture([luaSource(`
    function ${entry}(id) setChatVar(id,'reserved','called') end
    function ${mode}(id) setChatVar(id,'wrong','called') end
  `)]);
  await runtime.manual(config.chatId, { kind: 'manual', name: mode });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.reserved).toBe('called');
  expect(getDisplaySnapshot(config.chatId)?.vars.local.wrong).toBeUndefined();
});

test.each(['editInput', 'editOutput', 'editDisplay', 'editRequest'])('named dispatch preserves the reserved %s edit arguments', async mode => {
  const { runtime, config } = await triggerFixture([luaSource(`listenEdit('${mode}',function(id,value,meta)
    setChatVar(id,'reserved',type(value)..'|'..value..'|'..type(meta)); return value
  end)`)]);
  await runtime.manual(config.chatId, { kind: 'manual', name: mode });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.reserved).toBe('string||table');
});

test('named onButtonClick receives the default string argument', async () => {
  const { runtime, config } = await triggerFixture([luaSource(`function onButtonClick(id,value)
    setChatVar(id,'data',type(value)..'|'..tostring(value)) end`)]);
  await runtime.manual(config.chatId, { kind: 'manual', name: 'onButtonClick' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.data).toBe('string|');
});

test('an empty manual name selects declarative manual triggers', async () => {
  const { runtime, config } = await triggerFixture([
    { ...namedSource('named', [{ type: 'setvar', var: 'empty', value: 'called', operator: '=' }]), type: 'manual' },
  ]);
  await runtime.manual(config.chatId, { kind: 'manual', name: '' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.empty).toBe('called');
});

test('named Lua dispatch respects conditions and aborts the chain on a chunk error', async () => {
  const { runtime, config, refreshes } = await triggerFixture([
    { ...luaSource(`error('must not run')`), conditions: [{ type: 'var', var: 'enabled', operator: '=', value: 'yes' }] },
    luaSource(`function select(id) setChatVar(id,'before','saved') end`),
    luaSource(`error('chunk failed')`),
    luaSource(`function select(id) setChatVar(id,'after','wrong') end`),
  ]);
  await expect(runtime.manual(config.chatId, { kind: 'manual', name: 'select' })).rejects.toThrow('chunk failed');
  expect(getDisplaySnapshot(config.chatId)?.vars.local.before).toBe('saved');
  expect(getDisplaySnapshot(config.chatId)?.vars.local.after).toBeUndefined();
  expect(refreshes.filter(Boolean)).toEqual([]);
});

test('the production button adapter hashes and reads state without backend reads, then persists one variable batch', async () => {
  const { runtime, config, calls, failures } = await fixture(`
    onButtonClick = async(function(id, button)
      for i=1,64 do
        local digest = hash(id, 'value'):await()
        if #digest ~= 64 then error('invalid hash') end
        if getName(id) ~= 'Character' then error('wrong identity') end
        if getChat(id, 0).data ~= 'Hello' then error('wrong chat') end
        setChatVar(id, 'count', tostring(i))
      end
    end)
  `);
  await runtime.manual(config.chatId, { kind: 'button', value: 'click' });
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap', 'state.write']);
  expect(getDisplaySnapshot(config.chatId)?.vars.local.count).toBe('64');
  expect(failures).toEqual([]);
});

test('host message events update the next production Lua operation without a state fetch', async () => {
  const { runtime, config, calls, events } = await fixture(`function onButtonClick(id) setChatVar(id,'seen',getChat(id,0).data) end`);
  events.get('MESSAGE_EDITED')!({ chatId: config.chatId, message: { id: 'user-message', role: 'user', content: 'edited', index_in_chat: 1 } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  await runtime.manual(config.chatId, { kind: 'button', value: '' });
  expect(getDisplaySnapshot(config.chatId)?.vars.local.seen).toBe('edited');
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap', 'state.write']);
});

test('production display reads the current raw bubble without persisting it as chat text', async () => {
  const { config, calls } = await fixture(`listenEdit('editDisplay', function(id, data) return getChat(id,0).data end)`);
  const context = { chatId: config.chatId, messageId: 'user-message', role: 'user', isUser: true, depth: 0 };
  const current = withCurrentDisplayMessage(getDisplaySnapshot(config.chatId)!, context, 'current raw text');
  expect(await runEditDisplayChain(current, 'rendered', context, text => text, () => {})).toBe('current raw text');
  expect(getDisplaySnapshot(config.chatId)!.messagesHost[1]!.content).toBe('Hello');
  expect(calls.map(call => call.request.kind)).toEqual(['bootstrap']);
});

test('production display observes a native edit while its Lua callback is suspended', async () => {
  const { config, events, entered } = await fixture(`listenEdit('editDisplay', function(id, data)
    setChatVar(id, 'entered', '1'); hash(id,'pause'):await(); return getChat(id,0).data
  end)`);
  const context = { chatId: config.chatId, messageId: 'user-message', role: 'user', isUser: true, depth: 0 };
  const current = withCurrentDisplayMessage(getDisplaySnapshot(config.chatId)!, context, 'render input');
  const result = runEditDisplayChain(current, 'rendered', context, text => text, () => {});
  await entered;
  events.get('MESSAGE_EDITED')!({ chatId: config.chatId, message: { id: 'user-message', role: 'user', content: 'native edit', index_in_chat: 1 } }, { stateRevision: { epoch: 'host', sequence: 2 } });
  expect(await result).toBe('native edit');
});

test('late display configuration cannot restore old Lua sources after a newer configuration', async () => {
  const { runtime, config } = await fixture(`function onButtonClick(id) setChatVar(id,'source','old') end`);
  await runtime.snapshot({ ...snapshot(`function onButtonClick(id) setChatVar(id,'source','new') end`), configVersion: 3 });
  await runtime.snapshot({ ...config, configVersion: 2 });
  await runtime.manual(config.chatId, { kind: 'button', value: '' });
  expect(getDisplaySnapshot(config.chatId)!.vars.local.source).toBe('new');
});
