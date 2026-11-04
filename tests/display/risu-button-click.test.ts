import { describe, expect, mock, test } from 'bun:test';
import { createRisuButtonClickHandler, manualActionWillRun } from '../../src/display/risu-button-click.js';

function element(attributes: Record<string, string>) {
  return { getAttribute: (name: string) => attributes[name] ?? null };
}

function click(attributes: Record<string, string>, options: { chatId?: string | null; inMessage?: boolean; willRun?: boolean; fails?: boolean } = {}) {
  const pathEntry = (selector: string, extra: object) => ({ matches: (s: string) => s === selector, ...extra });
  const path = [
    { closest: (selector: string) => (selector === 'summary' ? null : element(attributes)) },
    ...(options.inMessage === false ? [] : [
      pathEntry('[data-component="MessageContent"]', { querySelectorAll: () => [] }),
      pathEntry('[data-message-id]', { dataset: { messageId: 'message' } }),
    ]),
  ];
  const event = { composedPath: () => path, preventDefault: mock(() => {}), stopPropagation: mock(() => {}) };
  const willRun = options.willRun ?? true;
  const run = mock(async (_message: unknown) => {
    if (options.fails) throw new Error('lua failed');
    return willRun;
  });
  const invalidateMessage = mock((_id: string) => {});
  const logged = mock((_message: string, _error: unknown) => {});
  createRisuButtonClickHandler({
    getChatId: () => (options.chatId === undefined ? 'chat' : options.chatId),
    willRun: () => willRun, run, invalidateMessage, log: { info() {}, warn() {}, error: logged },
  })(event as unknown as Event);
  return { event, run, invalidateMessage, logged };
}

describe('risu button clicks', () => {
  test.each([
    [{ 'risu-btn': 'close' }, { type: 'manual_button_click', btn: 'close', chatId: 'chat' }],
    [{ 'risu-btn': 'close', 'risu-id': '3' }, { type: 'manual_button_click', btn: 'close', btnId: '3', chatId: 'chat' }],
    [{ 'risu-trigger': 'fire' }, { type: 'manual_trigger', triggerName: 'fire', chatId: 'chat' }],
    [{ 'risu-trigger': 'fire', 'risu-id': '3' }, { type: 'manual_trigger', triggerName: 'fire', triggerId: '3', chatId: 'chat' }],
  ])('dispatches %j and cancels activation because the reload supersedes it', async (attributes, expected) => {
    const { event, run, invalidateMessage } = click(attributes);
    expect(run.mock.calls).toEqual([[expected]]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    await Bun.sleep(0);
    expect(invalidateMessage.mock.calls).toEqual([['message']]);
  });

  test('keeps native activation and skips the reload when no trigger will run', async () => {
    const { event, run, invalidateMessage } = click({ 'risu-btn': 'close' }, { willRun: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
    await Bun.sleep(0);
    expect(invalidateMessage).not.toHaveBeenCalled();
  });

  test('reloads after a failed run and logs the failure, since activation was already cancelled', async () => {
    const { invalidateMessage, logged } = click({ 'risu-btn': 'close' }, { fails: true });
    await Bun.sleep(0);
    expect(invalidateMessage.mock.calls).toEqual([['message']]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['manual_trigger', [{ source: { effect: [{ type: 'setvar' }] } }], true],
    ['manual_trigger', [], false],
    ['manual_button_click', [{ source: { effect: [{ type: 'setvar' }] } }], false],
    ['manual_button_click', [{ source: { effect: [{ type: 'triggerlua' }] } }], true],
  ])('%s with triggers %j will run: %j', (type, triggers, expected) => {
    expect(manualActionWillRun(triggers as never, { type } as never)).toBe(expected as boolean);
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
