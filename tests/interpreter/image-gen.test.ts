import { describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import type { DispatchData, HostApi, ScriptNS } from '../../src/interpreter/host.js';

function scriptNs(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error(name);
    },
  } as unknown as ScriptNS;
}

function baseApi(overrides: Partial<HostApi> = {}): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: '1' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => undefined,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
    ...overrides,
  } as unknown as HostApi;
}

describe('generateImage Lua bridge & inlay resolution', () => {
  test('returns error when lowLevelAccess is not granted', async () => {
    const api = baseApi({
      imageGen: {
        generate: async () => ({ imageId: 'img-1' }),
      },
    });
    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      lowLevelAccess: false,
    });

    let result: string | undefined;
    await runtime.runLua(`
      function onRun(triggerId)
        local res = generateImage(triggerId, "prompt"):await()
        setChatVar(triggerId, "res", res)
      end
    `);
    expect(runtime.getVar('res')).toBe('Error: lowLevelAccess required');
  });

  test('returns error when host imageGen is unavailable', async () => {
    const api = baseApi();
    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      lowLevelAccess: true,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local res = generateImage(triggerId, "prompt"):await()
        setChatVar(triggerId, "res", res)
      end
    `);
    expect(runtime.getVar('res')).toBe('Error: image generation not available on this host');
  });

  test('returns {{inlay::imageId}} when imageGen returns imageId', async () => {
    let receivedPrompt = '';
    let receivedNeg: string | undefined;
    let receivedParams: Record<string, unknown> | undefined;

    const api = baseApi({
      imageGen: {
        generate: async (prompt, opts) => {
          receivedPrompt = prompt;
          receivedNeg = opts?.negativePrompt;
          receivedParams = opts?.parameters;
          return { imageId: 'uuid-1234-5678' };
        },
      },
    });

    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      lowLevelAccess: true,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local opts = '{"steps":30,"sampler":"euler"}'
        local res = generateImage(triggerId, "beautiful scenery", "low quality", opts):await()
        setChatVar(triggerId, "res", res)
      end
    `);

    expect(runtime.getVar('res')).toBe('{{inlay::uuid-1234-5678}}');
    expect(receivedPrompt).toBe('beautiful scenery');
    expect(receivedNeg).toBe('low quality');
    expect(receivedParams).toEqual({ steps: 30, sampler: 'euler' });
  });

  test('uploads dataUrl to spindle.images when imageGen returns imageDataUrl', async () => {
    let uploadedDataUrl = '';
    const api = baseApi({
      imageGen: {
        generate: async () => ({
          imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        }),
      },
      images: {
        uploadFromDataUrl: async (dataUrl) => {
          uploadedDataUrl = dataUrl;
          return { id: 'img-uploaded-999' };
        },
      },
    });

    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      lowLevelAccess: true,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local res = generateImage(triggerId, "a cat"):await()
        setChatVar(triggerId, "res", res)
      end
    `);

    expect(runtime.getVar('res')).toBe('{{inlay::img-uploaded-999}}');
    expect(uploadedDataUrl).toContain('data:image/png;base64');
  });

  test('returns error string when imageGen throws', async () => {
    const api = baseApi({
      imageGen: {
        generate: async () => {
          throw new Error('GPU out of memory');
        },
      },
    });

    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      lowLevelAccess: true,
    });

    await runtime.runLua(`
      function onRun(triggerId)
        local res = generateImage(triggerId, "a huge scene"):await()
        setChatVar(triggerId, "res", res)
      end
    `);

    expect(runtime.getVar('res')).toBe('Error: image generation failed: GPU out of memory');
  });
});

describe('updateDisplay Lua bridge', () => {
  test('notifies state changed when updateDisplay is called from Lua', async () => {
    let notified = false;
    const api = baseApi();
    const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
      stateChanged: () => {
        notified = true;
      },
    });

    await runtime.runLua(`
      updateDisplay("trig")
    `);

    expect(notified).toBe(true);
  });
});
