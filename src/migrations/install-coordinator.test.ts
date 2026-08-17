import { describe, expect, test } from 'bun:test';

import {
  awaitRegexDelete,
  awaitRegexInstall,
  completeRegexDelete,
  completeRegexInstall,
} from './install-coordinator.js';

describe('migration install coordination', () => {
  test('accepts completion only from the requesting user', async () => {
    let requestId = '';
    const pending = awaitRegexInstall('user-1', (id) => { requestId = id; }, 100);
    expect(completeRegexInstall(requestId, 'user-2', {
      ok: true,
      cleanupCompleted: true,
    })).toBe(false);
    expect(completeRegexInstall(requestId, 'user-1', {
      ok: true,
      cleanupCompleted: true,
    })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true, cleanupCompleted: true });
  });

  test('fails closed when dispatch rejects', async () => {
    await expect(awaitRegexInstall(
      'user-1',
      async () => { throw new Error('send failed'); },
      100,
    )).resolves.toEqual({ ok: false, cleanupCompleted: false });
  });

  test('accepts a delete completion only from the requesting user', async () => {
    let requestId = '';
    const pending = awaitRegexDelete('user-1', (id) => { requestId = id; }, 100);
    expect(completeRegexDelete(requestId, 'user-2', { ok: true, deleted: 2 })).toBe(false);
    expect(completeRegexDelete(requestId, 'user-1', { ok: true, deleted: 2 })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true, deleted: 2 });
  });
});
