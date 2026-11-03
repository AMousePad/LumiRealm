import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { mountTogglesPanel } from '../../src/ui/toggles-tab.js';
import { createVariablesTogglesService } from '../../src/state/variables-toggles.js';
import { VariableStateStore } from '../../src/state/variables-state.js';
import { ToggleStateStore } from '../../src/state/toggle-state.js';
import { recordPresetToggleValues, resetPresetToggleValues } from '../../src/state/preset-toggle-values.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); resetPresetToggleValues(); });

test('shared preferences refresh another open drawer without replacing its chat values or controls', async () => {
  const dom = new Window();
  const originalDocument = globalThis.document;
  const originalSpindle = (globalThis as { spindle?: unknown }).spindle;
  globalThis.document = dom.document as unknown as Document;
  let preferences: Record<string, string> = { toggle_enabled: '0' };
  (globalThis as { spindle?: unknown }).spindle = {
    userStorage: {
      getJson: async () => structuredClone(preferences),
      setJson: async (_path: string, value: Record<string, string>) => { preferences = structuredClone(value); },
    },
    chats: { get: async (id: string) => ({ id, metadata: { chat_variables: { own: id } } }) },
  };
  cleanups.push(() => {
    globalThis.document = originalDocument;
    (globalThis as { spindle?: unknown }).spindle = originalSpindle;
    void dom.happyDOM.abort();
  });
  const active = { ownerUserId: 'owner', lumirealm: { user_overrides: {} },
    card: { character_id: 'character', risuPayload: { scriptstate_defaults: {} } } } as unknown as ActiveCard;
  const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
  const pending: Promise<void>[] = [];
  const seen: BackendToFrontend[] = [];
  const panels = ['a', 'b'].map(chatId => {
    const root = document.createElement('div');
    const panel = mountTogglesPanel({ root, log, sendToBackend: message => {
      if (message.type === 'request_variables_snapshot') pending.push(service.refreshVariables(active, message.chatId, 'owner', { force: true }));
    } });
    cleanups.unshift(() => panel.destroy());
    return { chatId, root, panel };
  });
  const service = createVariablesTogglesService({
    translateLang: 'en', variableState: new VariableStateStore(), toggleState: new ToggleStateStore(),
    readLumirealm: async () => null, readAttachedModuleEnvelopes: async () => [], ensureActiveCardForChat: async () => active,
    refreshBgHtml: async () => {}, log, errMsg: String,
    send: (message, userId) => { expect(userId).toBe('owner'); seen.push(message); for (const { panel } of panels) panel.handleBackendMessage(message); },
  });
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  for (const { chatId, panel } of panels) {
    recordPresetToggleValues(chatId, 'owner', `preset-${chatId}`, { toggle_enabled: chatId === 'a' ? '1' : '0' });
    panel.setActiveChatId(chatId);
    panel.handleBackendMessage({ type: 'set_toggle_definitions', chatId, seq: 1, ts: 1,
      toggles: [{ type: 'checkbox', key: 'enabled', value: 'Enabled' }], attribution: {} });
  }
  await drain();
  const controls = panels.map(({ root }) => root.querySelector<HTMLInputElement>('input')!);
  expect(controls.map(input => input.checked)).toEqual([false, false]);
  expect(await service.writeToggleValue('a', 'enabled', '1', 'owner')).toEqual({ ok: true });
  await drain();
  expect(controls.map(input => input.checked)).toEqual([true, true]);
  expect(await service.writeToggleValue('a', 'enabled', null, 'owner')).toEqual({ ok: true });
  await drain();
  expect(controls.map(input => input.checked)).toEqual([true, false]);
  for (const [index, { chatId, root }] of panels.entries()) {
    expect(root.querySelector('input')).toBe(controls[index]!);
    expect([...seen].reverse().find(message => message.type === 'set_variables' && message.chatId === chatId)).toMatchObject({
      scopes: { local: { own: chatId } },
    });
  }
});
