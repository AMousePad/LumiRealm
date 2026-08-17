import { afterEach, describe, expect, test } from 'bun:test';

import { resolveAlertDismissal } from './alert-bridge.js';
import { resolvePickResolution } from './pick-bridge.js';
import { makeSpindleHost } from './spindle-host.js';

function harness(options: {
  userId?: string | undefined;
  promptResult?: { value: string | null; cancelled: boolean };
  promptError?: Error;
  confirmResult?: { confirmed: boolean };
  confirmError?: Error;
  sendError?: Error;
  toastError?: Error;
  tokenResult?: { total_tokens: number };
  tokenError?: Error;
} = {}) {
  const userId = Object.hasOwn(options, 'userId') ? options.userId : 'user-1';
  const calls = {
    toast: [] as { kind: string; args: unknown[] }[],
    prompt: [] as unknown[][],
    confirm: [] as unknown[][],
    frontend: [] as unknown[][],
    tokens: [] as unknown[][],
  };
  const toast = (kind: string) => (...args: unknown[]) => {
    calls.toast.push({ kind, args });
    if (options.toastError) throw options.toastError;
  };
  (globalThis as { spindle?: unknown }).spindle = {
    generate: { raw: async () => ({ content: '' }) },
    toast: {
      info: toast('info'),
      success: toast('success'),
      warning: toast('warning'),
      error: toast('error'),
    },
    prompt: {
      async input(...args: unknown[]) {
        calls.prompt.push(args);
        if (options.promptError) throw options.promptError;
        return options.promptResult ?? { value: 'answer', cancelled: false };
      },
    },
    modal: {
      async confirm(...args: unknown[]) {
        calls.confirm.push(args);
        if (options.confirmError) throw options.confirmError;
        return options.confirmResult ?? { confirmed: true };
      },
    },
    sendToFrontend(...args: unknown[]) {
      calls.frontend.push(args);
      if (options.sendError) throw options.sendError;
    },
    tokens: {
      async countText(...args: unknown[]) {
        calls.tokens.push(args);
        if (options.tokenError) throw options.tokenError;
        return options.tokenResult ?? { total_tokens: 12 };
      },
    },
  };
  return {
    calls,
    host: makeSpindleHost({ chatId: 'chat-1', characterId: 'char-1', userId }),
  };
}

async function withoutBridgeTimers(run: () => Promise<void>): Promise<void> {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (() => 0) as unknown as typeof globalThis.setTimeout;
  try {
    await run();
  } finally {
    globalThis.setTimeout = original;
  }
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('spindle host UI', () => {
  test('maps toast kinds and user scope', () => {
    const { host, calls } = harness();

    host.ui!.toast!('plain');
    host.ui!.toast!('bad', 'error');
    host.ui!.toast!('careful', 'warning');
    host.ui!.toast!('done', 'success');

    expect(calls.toast).toEqual([
      { kind: 'info', args: ['plain', { userId: 'user-1' }] },
      { kind: 'error', args: ['bad', { userId: 'user-1' }] },
      { kind: 'warning', args: ['careful', { userId: 'user-1' }] },
      { kind: 'success', args: ['done', { userId: 'user-1' }] },
    ]);
  });

  test('does not broadcast a toast without a user and propagates toast failures', () => {
    const missing = harness({ userId: undefined });
    missing.host.ui!.toast!('hidden');
    expect(missing.calls.toast).toEqual([]);

    const toastError = new Error('toast failed');
    const failing = harness({ toastError });
    expect(() => failing.host.ui!.toast!('visible')).toThrow(toastError.message);
  });

  test('maps prompt and confirmation input and results', async () => {
    const message = 'x'.repeat(90);
    const { host, calls } = harness();

    expect(await host.ui!.prompt!(message, 'seed')).toBe('answer');
    expect(await host.ui!.confirm!('Proceed?')).toBeTrue();
    expect(calls.prompt).toEqual([[{
      title: 'x'.repeat(80), message, defaultValue: 'seed', userId: 'user-1',
    }]]);
    expect(calls.confirm).toEqual([[{ title: 'Confirm', message: 'Proceed?', userId: 'user-1' }]]);
  });

  test('preserves prompt cancellation and UI failure fallbacks', async () => {
    const cancelled = harness({
      promptResult: { value: 'ignored', cancelled: true },
      confirmResult: { confirmed: false },
    });
    expect(await cancelled.host.ui!.prompt!('Question')).toBeNull();
    expect(await cancelled.host.ui!.confirm!('Proceed?')).toBeFalse();

    const failing = harness({ promptError: new Error('prompt failed'), confirmError: new Error('confirm failed') });
    expect(await failing.host.ui!.prompt!('Question')).toBeNull();
    expect(await failing.host.ui!.confirm!('Proceed?')).toBeFalse();
  });

  test('routes alert and pick requests and preserves their wire results', async () => {
    await withoutBridgeTimers(async () => {
      const { host, calls } = harness();
      const alert = host.ui!.alert!('Danger', 'error');
      const alertPayload = calls.frontend[0]?.[0] as { requestId: string };

      expect(calls.frontend[0]).toEqual([
        { type: 'request_alert', requestId: alertPayload.requestId, message: 'Danger', kind: 'error' },
        'user-1',
      ]);
      expect(resolveAlertDismissal(alertPayload.requestId, 'user-1')).toEqual({ ok: true });
      await alert;

      const pick = host.ui!.pick!('Choose', ['one', 'two']);
      const pickPayload = calls.frontend[1]?.[0] as { requestId: string };
      expect(calls.frontend[1]).toEqual([
        { type: 'request_pick', requestId: pickPayload.requestId, title: 'Choose', options: ['one', 'two'] },
        'user-1',
      ]);
      expect(resolvePickResolution(pickPayload.requestId, 'user-1', 'two')).toEqual({ ok: true });
      expect(await pick).toBe('two');
    });
  });

  test('guards targeted UI requests and absorbs send failures', async () => {
    const missing = harness({ userId: undefined });
    await missing.host.ui!.alert!('Hidden');
    expect(await missing.host.ui!.pick!('Choose', ['one'])).toBeNull();
    expect(missing.calls.frontend).toEqual([]);

    const empty = harness();
    expect(await empty.host.ui!.pick!('Choose', [])).toBeNull();
    expect(empty.calls.frontend).toEqual([]);

    const failing = harness({ sendError: new Error('send failed') });
    await failing.host.ui!.alert!('Visible');
    expect(await failing.host.ui!.pick!('Choose', ['one'])).toBeNull();
  });
});

describe('spindle host tokens', () => {
  test('always exposes token counting and maps the user-scoped result', async () => {
    const { host, calls } = harness({ tokenResult: { total_tokens: 17 } });

    expect(host.tokens).toBeDefined();
    expect(await host.tokens!.count('count me')).toBe(17);
    expect(calls.tokens).toEqual([['count me', { userId: 'user-1' }]]);
  });

  test('preserves approximate fallback for invalid results and failures', async () => {
    const invalid = harness({ tokenResult: { total_tokens: Number.NaN } });
    expect(await invalid.host.tokens!.count('12345')).toBe(2);

    const failing = harness({ tokenError: new Error('token failed') });
    expect(await failing.host.tokens!.count('123456789')).toBe(3);
  });
});
