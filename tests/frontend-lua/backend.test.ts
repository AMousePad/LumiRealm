import { afterEach, expect, test } from 'bun:test';
import type { SpindleAPI } from 'lumiverse-spindle-types';
import { createFrontendLuaBackend, type FrontendLuaHostContract } from '../../src/frontend-lua/backend';
import { FrontendLuaUnavailableError } from '../../src/frontend-lua/protocol';
import type { RuntimeBootstrap } from '../../src/frontend-lua/state-contract';

const savedSpindle = (globalThis as any).spindle;
afterEach(() => { (globalThis as any).spindle = savedSpindle; });

function fixture() {
  const sent: { payload: any; userId: string; sessionId: string }[] = [];
  const reads: unknown[][] = [], writes: unknown[][] = [], configurations: unknown[][] = [];
  const state = { revision: { epoch: 'host', sequence: 1 }, globalVariables: { unset: null } };
  const capabilities: Record<string, number> = Object.fromEntries(['frontend-session-routing-v1', 'runtime-state-v1', 'required-context-handlers-v1', 'required-interceptors-v1'].map(key => [key, 1]));
  const host = {
    generate: { raw: async () => { throw new Error('Unexpected generation'); } },
    userStorage: { getJson: async () => null },
    host: { capabilities },
    runtimeState: {
      async read(...args: unknown[]) { reads.push(args); return state; },
      async write(...args: unknown[]) { writes.push(args); return { revision: state.revision, patch: {} }; },
    },
    sendToFrontend(payload: unknown, userId: string, options: { frontendSessionId: string }) {
      sent.push({ payload, userId, sessionId: options.frontendSessionId });
    },
  } as unknown as SpindleAPI & FrontendLuaHostContract;
  (globalThis as any).spindle = host;
  const bootstrap = async (...args: unknown[]) => {
    configurations.push(args);
    return { snapshot: { chatId: args[0] }, settings: {} } as Omit<RuntimeBootstrap, 'state'>;
  };
  return { host, bootstrap, sent, reads, writes, configurations, capabilities, state };
}

test('state refresh carries current user toggle preferences and preserves unrelated null values', async () => {
  const f = fixture();
  let preferences = { toggle_panel: '1' };
  (f.host as any).userStorage.getJson = async (_path: string, options: { userId: string }) => {
    expect(options.userId).toBe('owner');
    return preferences;
  };
  const backend = createFrontendLuaBackend(f.host, f.bootstrap);
  const call = { type: 'lua_service', requestId: 'request', chatId: 'chat', characterId: 'character', request: { kind: 'state.read' } };
  try {
    await backend.receive(call, 'owner', 'document');
    expect(f.sent.at(-1)!.payload.value.globalVariables).toEqual({ unset: null, toggle_panel: '1' });
    preferences = { toggle_panel: '0' };
    await backend.receive(call, 'owner', 'document');
    expect(f.sent.at(-1)!.payload.value.globalVariables).toEqual({ unset: null, toggle_panel: '0' });
  } finally { backend.dispose(); }
});

test('image and request services reach the authenticated host adapters', async () => {
  const f = fixture();
  const calls: unknown[] = [];
  Object.assign(f.host, {
    imageGen: { generate: async (input: unknown) => { calls.push(input); return { imageId: 'generated' }; } },
    images: { uploadFromDataUrl: async (...args: unknown[]) => { calls.push(args); return { id: 'uploaded' }; } },
    cors: async (...args: unknown[]) => { calls.push(args); return { status: 201, text: async () => 'response' }; },
  });
  const backend = createFrontendLuaBackend(f.host, f.bootstrap);
  const call = { type: 'lua_service', requestId: 'request', chatId: 'chat', characterId: 'character' };
  try {
    for (const request of [
      { kind: 'image.generate', prompt: 'scene', options: { connectionId: 'image-profile', parameters: { steps: 12 } } },
      { kind: 'image.upload', dataUrl: 'data:image/png;base64,AA==', name: 'image' },
      { kind: 'request', url: 'https://example.test' },
    ]) await backend.receive({ ...call, request }, 'owner', 'document');
    expect(calls).toEqual([
      { prompt: 'scene', owner_chat_id: 'chat', negativePrompt: undefined, connection_id: 'image-profile', parameters: { steps: 12 }, userId: 'owner' },
      ['data:image/png;base64,AA==', { originalFilename: 'image', owner_chat_id: 'chat', userId: 'owner' }],
      ['https://example.test', { method: 'GET' }],
    ]);
    expect(f.sent.map(message => message.payload)).toEqual([
      { type: 'lua_service_reply', requestId: 'request', ok: true, value: { imageId: 'generated' } },
      { type: 'lua_service_reply', requestId: 'request', ok: true, value: 'uploaded' },
      { type: 'lua_service_reply', requestId: 'request', ok: true, value: { status: 201, body: 'response' } },
    ]);
  } finally { backend.dispose(); }
});

test('production backend refuses missing host contracts and unowned invocations', async () => {
  const f = fixture();
  for (const capability of Object.keys(f.capabilities)) {
    f.capabilities[capability] = 0;
    expect(() => createFrontendLuaBackend(f.host, f.bootstrap)).toThrow(FrontendLuaUnavailableError);
    f.capabilities[capability] = 1;
  }
  const backend = createFrontendLuaBackend(f.host, f.bootstrap);
  try {
    for (const [user, session] of [[undefined, 'document'], ['user', undefined]]) {
      await expect(backend.call('chat', 'character', { kind: 'request', messages: [] }, user, session)).rejects.toBeInstanceOf(FrontendLuaUnavailableError);
    }
    expect(f.sent).toEqual([]);
    expect(f.reads).toEqual([]);
  } finally { backend.dispose(); }
});

test('one complete interceptor operation only accepts its authenticated document reply', async () => {
  const f = fixture(), backend = createFrontendLuaBackend(f.host, f.bootstrap);
  try {
    const operation = { kind: 'intercept' as const, messages: [{ role: 'user' as const, content: 'request' }], generationType: 'normal' };
    const pending = backend.call('chat', 'character', operation, 'user', 'document');
    const call = f.sent[0]!.payload;
    const reply = { type: 'lua_reply', sessionId: 'document', requestId: call.requestId, ok: true, value: 'accepted' };
    let complete = false;
    void pending.then(() => { complete = true; });
    await backend.receive(reply, 'user', 'other-document');
    await backend.receive(reply, 'other-user', 'document');
    expect(complete).toBe(false);
    await backend.receive(reply, 'user', 'document');
    expect(await pending).toBe('accepted');
    expect(f.sent).toEqual([{ payload: { ...call, operation }, userId: 'user', sessionId: 'document' }]);
    expect(f.reads).toEqual([]);
  } finally { backend.dispose(); }
});

test('state services use authenticated ownership and preserve mutation correlation', async () => {
  const f = fixture(), backend = createFrontendLuaBackend(f.host, f.bootstrap);
  try {
    const call = { type: 'lua_service', requestId: 'request', chatId: 'chat', characterId: 'character', userId: 'spoofed', sessionId: 'spoofed', request: { kind: 'bootstrap' } };
    await backend.receive(call, 'owner', 'document');
    expect(f.configurations).toEqual([['chat', 'character', 'owner']]);
    expect(f.reads).toEqual([['chat', 'character', 'owner']]);
    const command = { kind: 'chat.variables', values: { counter: '1' } };
    await backend.receive({ ...call, request: { kind: 'state.write', command, mutationId: 'mutation' } }, 'owner', 'document');
    expect(f.writes).toEqual([['chat', command, 'owner', 'mutation']]);
    expect(f.sent.every(message => message.userId === 'owner' && message.sessionId === 'document' && message.payload.ok)).toBe(true);
    await expect(backend.receive(call, 'owner', undefined)).rejects.toBeInstanceOf(FrontendLuaUnavailableError);
    expect(f.reads).toHaveLength(1);
  } finally { backend.dispose(); }
});

test('native state failures return an explicit error to the originating document', async () => {
  const f = fixture();
  f.host.runtimeState.read = async () => { throw new Error('Access denied'); };
  const backend = createFrontendLuaBackend(f.host, f.bootstrap);
  try {
    await backend.receive({ type: 'lua_service', requestId: 'request', chatId: 'chat', characterId: 'character', request: { kind: 'state.read' } }, 'owner', 'document');
    expect(f.sent).toEqual([{ payload: { type: 'lua_service_reply', requestId: 'request', ok: false, error: 'Access denied' }, userId: 'owner', sessionId: 'document' }]);
  } finally { backend.dispose(); }
});
