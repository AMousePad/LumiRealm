import { expect, test } from 'bun:test';
import { dispatchBinding, dispatchByManualName, makeDispatcherScriptNS, registerManualTriggers, type CompiledTriggerEntry } from '../../src/interpreter/dispatcher.js';
import type { HostApi, TriggerRuntimeOpts } from '../../src/interpreter/host.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import { execute } from '../../src/interpreter/lua-bridge.js';

function entry(source: TriggerScript): CompiledTriggerEntry {
  return { name: source.comment, source, code: '', type: 'trigger', triggers: [], binding: source.type,
    rtOpts: { characterId: 'character', displayMode: false, lowLevelAccess: false, binding: source.type } };
}

test('explicit frontend context reaches binding, manual, and nested triggers without a backend state read', async () => {
  const metadata: Record<string, unknown> = {};
  const unexpected = async (): Promise<never> => { throw new Error('Backend state read'); };
  const api: HostApi = {
    chat: { getMessages: unexpected, getMetadata: unexpected, setMetadata: async (key, value) => { metadata[key] = value; },
      sendMessage: unexpected, editMessage: unexpected, deleteMessage: unexpected, inject: unexpected },
    characters: { get: unexpected, update: unexpected },
  };
  const opts: TriggerRuntimeOpts = {
    chatId: 'chat', characterId: 'character',
    preloaded: { varsCache: {}, globalVars: {}, scriptstateDefaults: {}, messagesRaw: [], lorebook: { entries: [], primaryBookId: null },
      luaState: { character: { id: 'character', name: 'Local' }, persona: null, authorsNote: '' } },
    luaTemplate: value => value.replace('{{char}}', 'Local'),
    templateContext: async () => ({ chatId: 'chat', charName: 'Local', userName: 'User', character: {}, chat: {}, variables: {}, commit: false }),
  };
  const entries = [
    entry({ type: 'start', comment: 'binding', conditions: [], effect: [{ type: 'triggerlua', code: 'function onStart(id) setChatVar(id, "binding", cbs("{{char}}")) end' }] }),
    entry({ type: 'manual', comment: 'outer', conditions: [], effect: [{ type: 'runtrigger', value: 'inner' }] }),
    entry({ type: 'manual', comment: 'inner', conditions: [], effect: [{ type: 'setvar', var: 'manual', operator: '=', value: '{{char}}' }] }),
  ];
  const luaModes: unknown[] = [];
  const scriptNS = makeDispatcherScriptNS((code, globals, options) => { luaModes.push(options?.mode); return execute(code, globals, options); });
  registerManualTriggers(scriptNS, entries, api, opts);
  const ctx = { compiledTriggers: entries, api, data: {}, scriptNS, opts };
  await dispatchBinding(ctx, 'start');
  expect((metadata.chat_variables as Record<string, string>).binding).toBe('Local');
  await dispatchByManualName(ctx, 'outer');
  expect((metadata.chat_variables as Record<string, string>).manual).toBe('Local');
  expect(luaModes).toEqual(['start', 'outer', 'inner']);
});
