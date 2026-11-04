import { afterEach, expect, test } from 'bun:test';
import { makeDispatcherScriptNS, registerManualTriggers } from '../../src/interpreter/dispatcher.js';
import { getCurrentTriggerId, setCurrentTriggerId } from '../../src/interpreter/current-trigger-id.js';
import type { HostApi } from '../../src/interpreter/host.js';

afterEach(() => setCurrentTriggerId(null));

test('a nested manual trigger clears trigger_id and does not restore it, like Risu', async () => {
  const scriptNS = makeDispatcherScriptNS(async () => undefined as never);
  const api = {} as HostApi;
  registerManualTriggers(scriptNS, [], api);
  setCurrentTriggerId('7');
  const manual = await scriptNS.require('risu-manual-inner') as unknown as { run(ctx: { api: HostApi; data: { characterId: string; characterName: string; userName: string } }): Promise<unknown> };
  await manual.run({ api, data: { characterId: 'c', characterName: 'c', userName: 'u' } });
  expect(getCurrentTriggerId()).toBeNull();
});
