import { describe, expect, test } from 'bun:test';
import type { ModuleEnvelope } from '../state/modules-store.js';
import type { BackendToFrontend } from '../types/messages.js';
import { createModuleHandlers, type ModuleHandlerDeps } from './module.js';

const envelope: ModuleEnvelope = {
  schema_version: 1,
  id: 'module-id',
  filename: 'module.risum',
  uploaded_at: 1,
  module: { id: 'module-id', name: 'Module' } as never,
  asset_index: {},
};

function build() {
  const calls = { whole: 0, chunked: 0, get: 0, deleted: 0 };
  const deps = {
    processModuleUpload: async () => { calls.whole++; return { envelope }; },
    processRisumUpload: async () => { calls.chunked++; return { envelope }; },
    getUpload: async () => {
      calls.get++;
      return { fileName: 'module.charx', size: 1, data: Uint8Array.of(1) };
    },
    deleteUpload: async () => { calls.deleted++; return true; },
    nudgeGc: () => {},
    charactersAttachedTo: async () => [],
    pushModules: async () => {},
    log: { info: () => {}, warn: () => {} },
    errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
  } as unknown as ModuleHandlerDeps;
  const ctx = {
    userId: 'user-1',
    send: (_message: BackendToFrontend) => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: deps.errMsg,
  };
  return { calls, ctx, handler: createModuleHandlers(deps).process_module_from_upload };
}

describe('process_module_from_upload', () => {
  test('routes RisuM through the chunked source and deletes the staged upload', async () => {
    const { calls, ctx, handler } = build();
    await handler({ type: 'process_module_from_upload', uploadId: 'upload-1', fileName: 'large.risum' }, ctx);
    expect(calls).toEqual({ whole: 0, chunked: 1, get: 0, deleted: 1 });
  });

  test('keeps CharX on the existing whole-file path', async () => {
    const { calls, ctx, handler } = build();
    await handler({ type: 'process_module_from_upload', uploadId: 'upload-2', fileName: 'module.charx' }, ctx);
    expect(calls).toEqual({ whole: 1, chunked: 0, get: 1, deleted: 1 });
  });
});
