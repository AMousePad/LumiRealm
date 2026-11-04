import { describe, expect, mock, test } from 'bun:test';
import { createRisuButtonClickHandler } from '../../src/display/risu-button-click.js';

function element(attributes: Record<string, string>) {
  return { getAttribute: (name: string) => attributes[name] ?? null };
}

function click(attributes: Record<string, string>, options: { chatId?: string | null; inMessage?: boolean } = {}) {
  const pathEntry = (selector: string, extra: object) => ({ matches: (s: string) => s === selector, ...extra });
  const path = [
    { closest: (selector: string) => (selector === 'summary' ? null : element(attributes)) },
    ...(options.inMessage === false ? [] : [
      pathEntry('[data-component="MessageContent"]', { querySelectorAll: () => [] }),
      pathEntry('[data-message-id]', { dataset: { messageId: 'message' } }),
    ]),
  ];
  const event = { composedPath: () => path, preventDefault: mock(() => {}), stopPropagation: mock(() => {}) };
  const run = mock(async (_message: unknown) => true);
  const invalidateMessage = mock((_id: string) => {});
  createRisuButtonClickHandler({
    getChatId: () => (options.chatId === undefined ? 'chat' : options.chatId),
    run, invalidateMessage, log: { info() {}, warn() {}, error() {} },
  })(event as unknown as Event);
  return { event, run, invalidateMessage };
}

describe('risu button clicks', () => {
  test.each([
    [{ 'risu-btn': 'close' }, { type: 'manual_button_click', btn: 'close', chatId: 'chat' }],
    [{ 'risu-btn': 'close', 'risu-id': '3' }, { type: 'manual_button_click', btn: 'close', btnId: '3', chatId: 'chat' }],
    [{ 'risu-trigger': 'fire' }, { type: 'manual_trigger', triggerName: 'fire', chatId: 'chat' }],
    [{ 'risu-trigger': 'fire', 'risu-id': '3' }, { type: 'manual_trigger', triggerName: 'fire', triggerId: '3', chatId: 'chat' }],
  ])('dispatches %j without cancelling native activation', async (attributes, expected) => {
    const { event, run, invalidateMessage } = click(attributes);
    expect(run.mock.calls).toEqual([[expected]]);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    await Bun.sleep(0);
    expect(invalidateMessage.mock.calls).toEqual([['message']]);
  });

  test('leaves clicks alone outside a lumirealm chat', () => {
    const { event, run } = click({ 'risu-btn': 'close' }, { chatId: null });
    expect(run).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  test('leaves buttons outside a chat message inert like Risu', () => {
    const { event, run } = click({ 'risu-btn': 'close' }, { inMessage: false });
    expect(run).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
