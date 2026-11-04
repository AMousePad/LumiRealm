import { describe, expect, mock, test } from 'bun:test';
import { createRisuButtonClickHandler } from '../../src/display/risu-button-click.js';

function click(attributes: Record<string, string>, chatId: string | null = 'chat') {
  const element = { getAttribute: (name: string) => attributes[name] ?? null };
  const event = {
    composedPath: () => [{ closest: () => element }],
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
  const send = mock((_message: unknown) => {});
  createRisuButtonClickHandler({ getChatId: () => chatId, send, log: { info() {}, warn() {} } })(event as unknown as Event);
  return { event, send };
}

describe('risu button clicks', () => {
  test.each([
    [{ 'risu-btn': 'close' }, { type: 'manual_button_click', btn: 'close', chatId: 'chat' }],
    [{ 'risu-btn': 'close', 'risu-id': '3' }, { type: 'manual_button_click', btn: 'close', btnId: '3', chatId: 'chat' }],
    [{ 'risu-trigger': 'fire' }, { type: 'manual_trigger', triggerName: 'fire', chatId: 'chat' }],
  ])('dispatches %j without cancelling native activation', (attributes, expected) => {
    const { event, send } = click(attributes);
    expect(send.mock.calls).toEqual([[expected]]);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('leaves clicks alone outside a lumirealm chat', () => {
    const { event, send } = click({ 'risu-btn': 'close' }, null);
    expect(send).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
