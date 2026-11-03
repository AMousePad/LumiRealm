import { afterEach, expect, test } from 'bun:test';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import { createFrontendHost } from '../../src/frontend-lua/host.js';
import { runFrontendLuaOperation } from '../../src/frontend-lua/executor.js';
import { runtimeDisplaySnapshot } from '../../src/frontend-lua/snapshot.js';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly.js';
import { prepareTriggerSources } from '../../src/interpreter/dispatcher.js';
import { LOCAL_LORE_KEY, readLocalLore, upsertLocalLore } from '../../src/interpreter/runtime/local-lore.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { FrontendLuaOperation } from '../../src/frontend-lua/protocol.js';
import type { RuntimeStateDto, RuntimeStatePatch } from '../../src/frontend-lua/state-contract.js';
import { clearLuaEngines } from '../helpers/lua-bridge.js';

afterEach(() => clearLuaEngines());

function fixture(triggers: TriggerScript[]) {
  const active = { ownerUserId: 'owner', lumirealm: { user_overrides: {} }, card: {
    character_id: 'character', asset_index: {}, emotion_index: {}, risuPayload: { triggers,
      lua_scripts: triggers.map(trigger => trigger.effect[0]?.type === 'triggerlua' ? trigger.effect[0].code : ''),
      at_actions: [], scriptstate_defaults: {} },
  } } as unknown as ActiveCard;
  const config = { ...assembleRuntimeConfig({ modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false,
    getCompiledLibraries: () => [] }, active, 'chat', 'owner'), togglePreferences: null, presetToggles: {} };
  const dto: RuntimeStateDto = { revision: { epoch: 'host', sequence: 1 }, chat: { id: 'chat', metadata: {} },
    character: { id: 'character', name: 'Character', world_book_ids: ['book'] }, persona: null,
    messages: [], lore: [], globalVariables: {} };
  const state = new FrontendRuntimeState(dto, async command => {
    let patch: RuntimeStatePatch, value: unknown;
    if (command.kind === 'lore.upsertLocal') {
      dto.chat.metadata[LOCAL_LORE_KEY] = upsertLocalLore(readLocalLore(dto.chat.metadata), command.entry); patch = { chat: dto.chat };
    } else if (command.kind === 'lore.replaceLocal') {
      dto.chat.metadata[LOCAL_LORE_KEY] = structuredClone(command.entries); patch = { chat: dto.chat };
    } else if (command.kind === 'chat.variables') {
      dto.chat.metadata.chat_variables = { ...dto.chat.metadata.chat_variables as object, ...command.values }; patch = { chat: dto.chat };
    } else if (command.kind === 'lore.create') {
      const row = { ...command.patch, id: `entry-${dto.lore.length}`, world_book_id: command.bookId };
      dto.lore.push(row); patch = { loreEntry: row }; value = row;
    } else throw new Error(`Unexpected command: ${command.kind}`);
    dto.revision = { ...dto.revision, sequence: dto.revision.sequence + 1 };
    return structuredClone({ revision: dto.revision, patch, value });
  }, () => {});
  const host = createFrontendHost(state, () => runtimeDisplaySnapshot(config, state), DEFAULT_SETTINGS, {
    call: async () => { throw new Error('Unexpected host service'); }, ui: {}, expression: async () => {},
    invalidate() {}, synchronize: async () => {},
  }, []);
  return { state, local: () => readLocalLore(dto.chat.metadata), async run(operation: FrontendLuaOperation) {
    await runFrontendLuaOperation(operation, { ...host, data: { characterId: 'character' }, triggers: config.luaTriggers,
      compiled: prepareTriggerSources(triggers, 'character'), atActions: [] }, new AbortController().signal);
    await state.flush();
  } };
}

const lua = (code: string): TriggerScript => ({ type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua', code }] });
const create = (type: 'start' | 'input' | 'output' | 'manual', comment = ''): TriggerScript => ({ type, comment, conditions: [], effect: [{
  type: 'v2CreateLorebook', name: 'Global', nameType: 'value', key: 'global', keyType: 'value', content: 'global', contentType: 'value',
  insertOrder: '100', insertOrderType: 'value', indent: 0,
}] });

test.each(['button', 'editInput', 'editOutput'] as const)('live %s hook persists and immediately reads chat-local lore', async mode => {
  const body = "upsertLocalLoreBook(id,'Local','value',{}); setChatVar(id,'seen',tostring(#getLoreBooks(id,'Local')))";
  const code = mode === 'button' ? `function onButtonClick(id) ${body} end` : `listenEdit('${mode}', function(id,text) ${body}; return text end)`;
  const f = fixture([lua(code)]);
  await f.run(mode === 'button' ? { kind: 'button', value: 'test' } : { kind: 'edit', mode, value: 'text' });
  expect(f.local()).toHaveLength(1); expect(f.state.variables().seen).toBe('1');
});

for (const mode of ['start', 'input', 'output', 'manual'] as const) test.each([false, true])(`${mode} preserves Risu's independent character and returned-chat copies: adopt=%s`, async adopt => {
  const name = mode === 'manual' ? 'probe' : `on${mode[0]!.toUpperCase()}${mode.slice(1)}`;
  const triggers = [lua(`function ${name}(id) upsertLocalLoreBook(id,'Local','value',{}); setChatVar(id,'before',tostring(#getLoreBooks(id,'Local'))) end`)];
  if (adopt) triggers.push(create(mode, 'probe'));
  triggers.push(lua(`function ${name}(id) setChatVar(id,'after',tostring(#getLoreBooks(id,'Local'))) end`));
  const f = fixture(triggers);
  await f.run(mode === 'manual' ? { kind: 'manual', name: 'probe' } : { kind: 'binding', binding: mode });
  expect(f.state.variables().before).toBe('0');
  expect(f.state.variables().after).toBe(adopt ? '1' : '0');
  expect(f.local()).toHaveLength(adopt && mode === 'input' ? 1 : 0);
});

test('child character adoption does not replace the parent character copy', async () => {
  const parent = lua("function onInput(id) upsertLocalLoreBook(id,'Parent','parent',{}) end");
  parent.type = 'input';
  parent.effect.unshift({ type: 'setvar', var: 'parent', value: '1', operator: '=' });
  parent.effect.push({ type: 'runtrigger', value: 'child' });
  const f = fixture([
    parent,
    lua("function child(id) upsertLocalLoreBook(id,'Child','child',{}) end"),
    create('manual', 'child'),
    lua("function onInput(id) setChatVar(id,'childVisible',tostring(#getLoreBooks(id,'Child'))) end"),
    create('input'),
    lua("function onInput(id) setChatVar(id,'parentVisible',tostring(#getLoreBooks(id,'Parent'))); setChatVar(id,'childAfterParent',tostring(#getLoreBooks(id,'Child'))) end"),
  ]);
  await f.run({ kind: 'binding', binding: 'input' });
  expect(f.state.variables()).toMatchObject({ childVisible: '1', parentVisible: '1', childAfterParent: '0' });
  expect(f.local().map(entry => entry.comment)).toEqual(['Parent']);
});

test.each([false, true])('upserts after character adoption are immediately live, even when adoption changes no entries: prior=%s', async prior => {
  const triggers = prior ? [lua("function onInput(id) upsertLocalLoreBook(id,'First','first',{}) end")] : [];
  triggers.push(create('input'), lua("function onInput(id) upsertLocalLoreBook(id,'Second','second',{}); setChatVar(id,'seen',tostring(#getLoreBooks(id,'Second'))) end"));
  const f = fixture(triggers);
  await f.run({ kind: 'binding', binding: 'input' });
  expect(f.state.variables().seen).toBe('1');
  expect(f.local().map(entry => entry.comment)).toEqual(prior ? ['First', 'Second'] : ['Second']);
});
for (const childWrites of [false,true]) for (const readopt of [false,true]) test(`nested abort keeps selected child: childWrites=${childWrites}, readopt=${readopt}`, async () => {
 const first=lua(`function onInput(id) upsertLocalLoreBook(id,'Parent','parent',{}) end\nfunction child(id) ${childWrites?"upsertLocalLoreBook(id,'Child','child',{})":""} end`);
 const parent=create('input'); parent.effect.push({type:'runtrigger',value:'child'});
 const child=create('manual','child');child.effect.push({type:'v2MakeArrayVar',var:'[]',indent:0});
 const triggers=[first,parent,child,lua("function onInput(id) upsertLocalLoreBook(id,'Later','later',{});setChatVar(id,'laterSeen',tostring(#getLoreBooks(id,'Later'))) end")];
 if(readopt)triggers.push(create('input'),lua("function onInput(id) upsertLocalLoreBook(id,'Last','last',{});setChatVar(id,'lastSeen',tostring(#getLoreBooks(id,'Last'))) end"));
 const f=fixture(triggers);await f.run({kind:'binding',binding:'input'});
 expect(f.state.variables().laterSeen).toBe('0');
 expect(f.local().map(e=>e.comment)).toEqual(readopt?['Parent','Later','Last']:childWrites?['Parent','Child']:['Parent']);
 if(readopt)expect(f.state.variables().lastSeen).toBe('1');
});
for(const childWrites of [false,true])test(`nested throw keeps selected child: childWrites=${childWrites}`,async()=>{
 const first=lua(`function onInput(id) upsertLocalLoreBook(id,'Parent','parent',{}) end\nfunction child(id) ${childWrites?"upsertLocalLoreBook(id,'Child','child',{})":""} end`);
 const parent=create('input');parent.effect.push({type:'runtrigger',value:'child'});
 const child=create('manual','child');child.effect.push({type:'triggerlua',code:"error('expected chunk failure')"});
 const f=fixture([first,parent,child]);await expect(f.run({kind:'binding',binding:'input'})).rejects.toThrow('expected chunk failure');
 await f.state.flush();
 expect(f.local().map(e=>e.comment)).toEqual(childWrites?['Parent','Child']:['Parent']);
});

