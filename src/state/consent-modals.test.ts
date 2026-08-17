import { describe, expect, test } from 'bun:test';
import { makeQueueModalConfirm, type ModalConfirmDeps } from './consent-modals.js';

const options = {
  title: 'Title',
  message: 'Message',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
};

function queue(confirmModal: ModalConfirmDeps['confirmModal']) {
  const warns: string[] = [];
  return {
    warns,
    value: makeQueueModalConfirm({
      confirmModal,
      log: { warn: (message) => { warns.push(message); } },
      errMsg: (error) => error instanceof Error ? error.message : String(error),
    }),
  };
}

describe('makeQueueModalConfirm', () => {
  test('passes the user and result through unchanged', async () => {
    const calls: unknown[] = [];
    const { value } = queue(async (input) => {
      calls.push(input);
      return { confirmed: true };
    });

    await expect(value('user-1', options)).resolves.toEqual({ confirmed: true });
    expect(calls).toEqual([{ ...options, userId: 'user-1' }]);
  });

  test('serializes modal calls for the same user', async () => {
    const calls: string[] = [];
    const resolvers: Array<(value: { confirmed: boolean }) => void> = [];
    const { value } = queue((input) => new Promise((resolve) => {
      calls.push(input.title);
      resolvers.push(resolve);
    }));

    const first = value('user-1', { ...options, title: 'first' });
    const second = value('user-1', { ...options, title: 'second' });
    await Bun.sleep(0);
    expect(calls).toEqual(['first']);
    resolvers[0]!({ confirmed: true });
    await first;
    await Bun.sleep(0);
    expect(calls).toEqual(['first', 'second']);
    resolvers[1]!({ confirmed: false });
    await expect(second).resolves.toEqual({ confirmed: false });
  });

  test('keeps modal failures non-fatal', async () => {
    const { value, warns } = queue(async () => { throw new Error('failed'); });

    await expect(value('user-1', options)).resolves.toBeNull();
    expect(warns).toEqual(['queueModalConfirm: modal.confirm threw: failed']);
  });
});
