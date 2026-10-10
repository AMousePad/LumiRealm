import { expect, test } from 'bun:test';
import { createFrontendHost } from '../../src/frontend-lua/host';
import { FrontendRuntimeState } from '../../src/frontend-lua/state';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge';
import type { DisplaySnapshot } from '../../src/display/snapshot';

test('browser Lua forwards image settings and awaits the request service', async () => {
  const state = new FrontendRuntimeState({
    revision: { epoch: 'test', sequence: 1 }, chat: { id: 'chat', metadata: {} },
    character: { id: 'character', name: 'Character' }, persona: null, messages: [], lore: [], globalVariables: {},
  }, async () => { throw new Error('Unexpected write'); }, () => {});
  const calls: unknown[] = [];
  const snapshot = { vars: { local: {}, global: {}, chat: {} }, scriptstateDefaults: {}, lorebookHost: [] } as unknown as DisplaySnapshot;
  const settings = { ...DEFAULT_SETTINGS, imageConnectionId: 'image-profile', imageModelOverride: 'image-model' };
  const env = createFrontendHost(state, () => snapshot, settings, {
    call: async <T>(request: unknown) => {
      calls.push(request);
      return ((request as { kind: string }).kind === 'image.generate'
        ? { imageId: 'generated' } : { status: 200, body: 'response' }) as T;
    },
    ui: {}, expression: async () => {}, invalidate() {}, synchronize: async () => {},
  });
  const runtime = await makeRisuTriggerRuntime(env.api, {}, makeDispatcherScriptNS(execute), {
    ...env.prepareRuntime(), lowLevelAccess: true, binding: 'start',
  });
  try {
    expect(await runtime.runLua(`onStart=async(function(id)
      local image=generateImage(id,'scene'):await()
      local response=request(id,'https://example.test'):await()
      return image..'|'..json.decode(response).data
    end)`)).toBe('{{inlay::generated}}|response');
    expect(calls[0]).toMatchObject({ kind: 'image.generate', prompt: 'scene', options: { connectionId: 'image-profile', model: 'image-model' } });
    expect(calls[1]).toEqual({ kind: 'request', url: 'https://example.test' });
  } finally { await clearLuaEngines(); }
});
