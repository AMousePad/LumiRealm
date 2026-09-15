import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { mountTogglesPanel } from '../../src/ui/toggles-tab.js';

test('ignores variables from the previous chat after switching toggles', () => {
  const window = new Window();
  const originalDocument = globalThis.document;
  globalThis.document = window.document as unknown as Document;
  const root = document.createElement('div');
  const panel = mountTogglesPanel({
    root,
    sendToBackend: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
  });
  const pushValues = (chatId: string, seq: number, value: string): void => {
    panel.handleBackendMessage({
      type: 'set_variables', chatId, seq, defaults: {}, ts: 1,
      scopes: { local: {}, chat: {}, global: { toggle_enabled: value } },
    });
  };
  const checked = (): boolean => root.querySelector<HTMLInputElement>('input')!.checked;
  try {
    panel.setActiveChatId('chat-a');
    pushValues('chat-a', 1, '0');
    panel.setActiveChatId('chat-b');
    panel.handleBackendMessage({
      type: 'set_toggle_definitions', chatId: 'chat-b', seq: 1, ts: 1,
      toggles: [{ type: 'checkbox', key: 'enabled', value: 'Enabled' }],
      attribution: {},
    });
    pushValues('chat-b', 2, '1');
    expect(checked()).toBe(true);

    pushValues('chat-a', 100, '0');
    expect(checked()).toBe(true);

    pushValues('chat-b', 1, '0');
    expect(checked()).toBe(true);
    pushValues('chat-b', 3, '0');
    expect(checked()).toBe(false);
  } finally {
    panel.destroy();
    if (originalDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});
