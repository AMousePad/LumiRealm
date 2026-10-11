import { expect, test } from 'bun:test';
import { createConsentApi } from '../../src/state/consent-modals.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

test('cancelling module consent removes its prompt and releases the next request', async () => {
  const prompts: BackendToFrontend[] = [];
  const api = createConsentApi({ send: msg => { prompts.push(msg); }, log: { info() {}, warn() {} } });
  const abort = new AbortController();
  const options = { title: 'Module', message: 'Allow?', confirmLabel: 'Allow', cancelLabel: 'Decline' };
  const pending = api.requestConsent(options, 'owner', abort.signal);
  await Promise.resolve();
  expect(api.pendingConsents.size).toBe(1);
  abort.abort();
  expect(await pending).toEqual({ confirmed: false });
  expect(api.pendingConsents.size).toBe(0);
  const next = api.requestConsent(options, 'owner');
  await Promise.resolve();
  expect(prompts).toHaveLength(2);
  for (const [id, prompt] of api.pendingConsents) { api.pendingConsents.delete(id); prompt.resolver(true); }
  expect(await next).toEqual({ confirmed: true });
});

test('a cancelled queued consent request never opens a stale prompt', async () => {
  const api = createConsentApi({ send() {}, log: { info() {}, warn() {} } });
  const abort = new AbortController(); abort.abort();
  expect(await api.requestConsent({ title: 'Module', message: 'Allow?', confirmLabel: 'Allow', cancelLabel: 'Decline' }, 'owner', abort.signal)).toEqual({ confirmed: false });
  expect(api.pendingConsents.size).toBe(0);
});
