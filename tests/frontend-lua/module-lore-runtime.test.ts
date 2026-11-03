import { afterEach, expect, test } from 'bun:test';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { ActiveCard } from '../../src/interpreter/dispatch';
import type { TriggerScript } from '../../src/core/schemas/triggerscript';
import type { RuntimeServiceCall } from '../../src/frontend-lua/services';
import type { RuntimeStateDto, RuntimeStatePatch } from '../../src/frontend-lua/state-contract';
import { setupFrontendLua } from '../../src/frontend-lua/frontend';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store';
import { getDisplaySnapshot } from '../../src/display/snapshot';
import { createDisplayResolver } from '../../src/display/resolver';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function fixture(characterBook: 'absent' | 'empty' | 'populated', attachedModule: boolean | 'empty' = false) {
  const code = `
    function readModule(id)
      local books = getLoreBooks(id, 'shared-library')
      setChatVar(id, 'module', #books > 0 and books[1].content or 'missing')
    end
    listenEdit('editDisplay', function(id, text)
      local books = getLoreBooks(id, 'shared-library')
      return text .. ':' .. (#books > 0 and books[1].content or 'missing')
    end)
  `;
  const triggers: TriggerScript[] = [
    { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua', code }] },
    { type: 'manual', comment: 'readCharacter', conditions: [], effect: [
      { type: 'v2GetLorebookCountNew', outputVar: 'count', indent: 0 },
      { type: 'v2GetLorebookByIndex', index: '0', indexType: 'value', outputVar: 'entry', indent: 0 },
    ] },
    { type: 'manual', comment: 'modifyCharacter', conditions: [], effect: [
      { type: 'v2ModifyLorebookByIndex', index: '0', indexType: 'value', name: 'Character', nameType: 'value',
        key: 'character', keyType: 'value', content: 'updated', contentType: 'value', insertOrder: '100', insertOrderType: 'value', indent: 0 },
    ] },
    { type: 'manual', comment: 'deleteCharacter', conditions: [], effect: [
      { type: 'v2DeleteLorebookByIndex', index: '0', indexType: 'value', indent: 0 },
    ] },
  ];
  const card = { lumirealm: { user_overrides: {
    attached_module_world_books: attachedModule ? { attached: 'attached-book' } : {},
  } }, card: {
    character_id: 'character', asset_index: {}, emotion_index: {},
    risuPayload: { triggers, lua_scripts: [code], at_actions: [], scriptstate_defaults: {},
      extra: { runtime_module_lorebooks: { global: [
        { comment: 'shared-library', key: 'library', content: 'module content', worldBookId: 'module-book' },
        { comment: 'second-library', key: 'second', content: 'second content', worldBookId: 'module-book' },
      ], ...(attachedModule ? { attached: attachedModule === 'empty' ? [] : [
        { comment: 'shared-library', key: 'library', content: 'stale attached', worldBookId: 'attached-book' },
      ] } : {}) } },
    },
  } } as unknown as ActiveCard;
  const config = { ...assembleRuntimeConfig({
    modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false, getCompiledLibraries: () => [],
  }, card, 'module-chat', 'owner'), togglePreferences: null, presetToggles: {} };
  const state: RuntimeStateDto = {
    revision: { epoch: 'host', sequence: 1 }, chat: { id: config.chatId, metadata: { chat_variables: {} } },
    character: { id: config.characterId, world_book_ids: [
      ...(attachedModule ? ['attached-book'] : []), ...(characterBook === 'absent' ? [] : ['character-book']),
    ] },
    persona: null, messages: [], globalVariables: {},
    lore: [...(characterBook === 'populated' ? [
      { id: 'character-entry', world_book_id: 'character-book', key: ['character'], comment: 'Character', content: 'character content' },
    ] : []), ...(attachedModule === true ? [
      { id: 'attached-entry', world_book_id: 'attached-book', key: ['library'], comment: 'shared-library', content: 'live attached' },
    ] : [])],
  };
  const calls: RuntimeServiceCall[] = [];
  const failures: unknown[] = [];
  let runtime!: ReturnType<typeof setupFrontendLua>;
  const ctx = {
    frontendSessionId: '0123456789abcdef0123456789abcdef',
    events: { on: () => () => {} }, ui: {}, display: { setExpression() {} },
    sendToBackend(raw: unknown) {
      const call = structuredClone(raw) as RuntimeServiceCall;
      calls.push(call);
      queueMicrotask(() => {
        try {
          let value: unknown;
          if (call.request.kind === 'bootstrap') value = { snapshot: config, state, settings: DEFAULT_SETTINGS };
          else if (call.request.kind === 'state.write') {
            const command = call.request.command;
            let patch: RuntimeStatePatch;
            if (command.kind === 'chat.variables') {
              state.chat.metadata.chat_variables = { ...state.chat.metadata.chat_variables as object, ...command.values };
              patch = { chat: state.chat };
            } else if (command.kind === 'lore.update' || command.kind === 'lore.delete') {
              const index = state.lore.findIndex(entry => entry.id === command.id);
              if (index < 0) throw new Error('Runtime lore entry not found');
              if (command.kind === 'lore.update') {
                const entry = { ...state.lore[index]!, ...command.patch };
                state.lore[index] = entry; value = entry; patch = { loreEntry: entry };
              } else { state.lore.splice(index, 1); patch = { deletedLoreId: command.id }; }
            } else throw new Error('Unexpected runtime command');
            state.revision = { ...state.revision, sequence: state.revision.sequence + 1 };
            value = { revision: state.revision, patch, value };
          } else throw new Error('Unexpected runtime service');
          runtime.receive(structuredClone({ type: 'lua_service_reply', requestId: call.requestId, ok: true, value }));
        } catch (error) {
          runtime.receive({ type: 'lua_service_reply', requestId: call.requestId, ok: false, error: String(error) });
        }
      });
    },
  } as unknown as SpindleFrontendContext;
  const resolver = createDisplayResolver();
  runtime = setupFrontendLua(ctx, (_chatId, _keys, resetScripts) => {
    if (resetScripts) resolver.resetScriptCache();
  }, error => failures.push(error));
  cleanups.push(() => runtime.dispose());
  await runtime.snapshot(config);
  return { runtime, config, calls, failures, resolver,
    run: (name: string) => runtime.manual(config.chatId, { kind: 'manual', name }),
    vars: () => getDisplaySnapshot(config.chatId)!.vars.local,
  };
}

test.each(['absent', 'empty', 'populated'] as const)('global module lore stays separate from %s character lore through browser dispatch', async characterBook => {
  const f = await fixture(characterBook);
  await f.run('readModule');
  expect(f.vars().module).toBe('module content');
  await f.run('readCharacter');
  expect(f.vars().count).toBe(characterBook === 'populated' ? '1' : '0');
  expect(f.vars().entry).toBe(characterBook === 'populated' ? 'character content' : 'null');
  await f.run('modifyCharacter');
  await f.run('readCharacter');
  expect(f.vars().entry).toBe(characterBook === 'populated' ? 'updated' : 'null');
  await f.run('deleteCharacter');
  await f.run('readCharacter');
  expect(f.vars().count).toBe('0');
  await f.run('readModule');
  expect(f.vars().module).toBe('module content');
  const loreWrites = f.calls.flatMap(call => call.request.kind === 'state.write' && call.request.command.kind.startsWith('lore.') ? [call.request.command] : []);
  expect(loreWrites.map(command => [command.kind, 'id' in command ? command.id : undefined]))
    .toEqual(characterBook === 'populated' ? [['lore.update', 'character-entry'], ['lore.delete', 'character-entry']] : []);
  expect(f.failures).toEqual([]);
});

test('an attached module book never becomes the character lorebook', async () => {
  const f = await fixture('absent', true);
  await f.run('readCharacter');
  expect(f.vars().count).toBe('0');
  expect(f.vars().entry).toBe('null');
  await f.run('modifyCharacter');
  await f.run('deleteCharacter');
  expect(f.calls.filter(call => call.request.kind === 'state.write' && call.request.command.kind.startsWith('lore.'))).toEqual([]);
  expect(getDisplaySnapshot(f.config.chatId)!.lorebookHost.map(entry => entry.content))
    .toEqual(['module content', 'second content', 'live attached']);
  expect(f.failures).toEqual([]);
});

test('an empty attached module book cannot hide the character book that follows it', async () => {
  const f = await fixture('populated', 'empty');
  await f.run('readCharacter');
  expect(f.vars().count).toBe('1');
  expect(f.vars().entry).toBe('character content');
  await f.run('modifyCharacter');
  await f.run('readCharacter');
  expect(f.vars().entry).toBe('updated');
  expect(f.failures).toEqual([]);
});

test('Lua follows module library order for matching names across global and attached books', async () => {
  const f = await fixture('populated', true);
  await f.run('readModule');
  expect(f.vars().module).toBe('module content');
  expect(getDisplaySnapshot(f.config.chatId)!.lorebookHost.map(entry => entry.content))
    .toEqual(['character content', 'module content', 'second content', 'live attached']);
  await f.runtime.snapshot({ ...f.config, configVersion: 2,
    moduleLorebooks: [f.config.moduleLorebooks[2], ...f.config.moduleLorebooks.slice(0, 2)],
  });
  await f.run('readModule');
  expect(f.vars().module).toBe('live attached');
  await f.run('readCharacter');
  expect(f.vars().count).toBe('1');
  expect(f.vars().entry).toBe('character content');
});

test('global module lore reaches display Lua and refreshes or detaches without stale rows', async () => {
  const f = await fixture('absent');
  const render = async () => (await f.resolver.resolveBody({ content: 'panel', context: {
    chatId: f.config.chatId, characterId: f.config.characterId, messageIndex: 0, isUser: false, depth: 0,
  } }))?.content;
  expect(await render()).toBe('panel:module content');
  await f.runtime.snapshot({ ...f.config, configVersion: 2, moduleLorebooks: [
    { comment: 'shared-library', content: 'refreshed', key: 'library', worldBookId: 'module-book' },
  ] });
  expect(await render()).toBe('panel:refreshed');
  await f.runtime.snapshot({ ...f.config, configVersion: 3, moduleLorebooks: [] });
  expect(await render()).toBe('panel:missing');
  expect(f.failures).toEqual([]);
});
