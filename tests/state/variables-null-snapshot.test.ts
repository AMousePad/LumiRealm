import { expect, test } from 'bun:test';
import { createVariablesTogglesService } from '../../src/state/variables-toggles.js';
import { VariableStateStore } from '../../src/state/variables-state.js';
import { ToggleStateStore } from '../../src/state/toggle-state.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { DisplaySnapshot } from '../../src/display/snapshot.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

test('variable refresh preserves null in UI and display snapshots and distinguishes later empty values', async () => {
  const global = globalThis as unknown as { spindle?: unknown };
  const previous = global.spindle;
  const local: Record<string, unknown> = { missing: null, empty: '', literal: 'null', number: 0 };
  const sent: BackendToFrontend[] = [];
  const snapshots: DisplaySnapshot['vars'][] = [];
  const active = {
    card: { character_id: 'character', risuPayload: { scriptstate_defaults: { missing: 'DEFAULT' } } },
    lumirealm: { user_overrides: {} },
  } as unknown as ActiveCard;
  global.spindle = { chats: { get: async () => ({ metadata: { chat_variables: local, macro_variables: { global: { missing: null } } } }) } };
  const service = createVariablesTogglesService({
    translateLang: 'en', variableState: new VariableStateStore(), toggleState: new ToggleStateStore(),
    readLumirealm: async () => null, readAttachedModuleEnvelopes: async () => [],
    ensureActiveCardForChat: async () => active, refreshBgHtml: async () => {},
    send: message => { sent.push(message); },
    pushDisplaySnapshot: (_active, _chatId, _userId, vars) => { snapshots.push(vars); },
    log: { info() {}, warn() {}, debug() {} }, errMsg: String,
  });
  try {
    await service.refreshVariables(active, 'chat', 'user');
    expect(snapshots[0]).toEqual({ local: { missing: null, empty: '', literal: 'null', number: '0' }, global: { missing: null }, chat: {} });
    expect(sent[0]).toMatchObject({ type: 'set_variables', seq: 1, scopes: snapshots[0], defaults: { missing: 'DEFAULT' } });
    local.missing = '';
    await service.refreshVariables(active, 'chat', 'user');
    expect(sent[1]).toMatchObject({ type: 'set_variables', seq: 2, scopes: { local: { missing: '' } } });
    local.missing = null;
    await service.refreshVariables(active, 'chat', 'user');
    expect(sent[2]).toMatchObject({ type: 'set_variables', seq: 3, scopes: { local: { missing: null } } });
    delete local.missing;
    await service.refreshVariables(active, 'chat', 'user');
    expect(sent[3]).toMatchObject({ type: 'set_variables', seq: 4 });
    expect(snapshots[3]?.local).not.toHaveProperty('missing');
  } finally {
    if (previous === undefined) delete global.spindle;
    else global.spindle = previous;
  }
});
