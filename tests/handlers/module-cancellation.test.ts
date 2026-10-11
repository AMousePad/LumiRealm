import { describe, expect, test } from 'bun:test';
import { createModuleHandlers, type ModuleHandlerDeps } from '../../src/handlers/module.js';
import type { HandlerCallCtx } from '../../src/handlers/types.js';
import type { ModuleUploadControl } from '../../src/state/module-upload.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

function fixture() {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<ModuleUploadControl>();
  const messages: BackendToFrontend[] = [];
  let deleted = 0;
  const process: ModuleHandlerDeps['processRisumUpload'] = async (_id, _file, _uid, control) => {
    started.resolve(control);
    await gate.promise;
    control.signal.throwIfAborted();
    control.beginSave();
    return { envelope: { id: 'module', module: { name: 'Example' } } as never };
  };
  const handlers = createModuleHandlers({
    processRisumUpload: process,
    processModuleUpload: process as unknown as ModuleHandlerDeps['processModuleUpload'],
    getUpload: async () => ({ data: Uint8Array.of(1), size: 1, fileName: 'module.charx' }),
    deleteUpload: async () => { deleted++; return true; },
    nudgeGc() {}, charactersAttachedTo: async () => [], pushModules: async () => {},
    log: { info() {}, warn() {} }, errMsg: String,
  } as unknown as ModuleHandlerDeps);
  const ctx: HandlerCallCtx = { userId: 'owner', send: msg => { messages.push(msg); },
    log: { info() {}, warn() {}, error() {} }, errMsg: String };
  return { handlers, ctx, messages, gate, started, deleted: () => deleted };
}

describe('module cancellation routing', () => {
  for (const extension of ['risum', 'charx']) {
    test(`cancels ${extension} processing only for its owning user and upload`, async () => {
      const f = fixture();
      const run = f.handlers.process_module_from_upload({ type: 'process_module_from_upload', uploadId: 'upload', fileName: `module.${extension}` }, f.ctx);
      const control = await f.started.promise;
      await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'upload' }, { ...f.ctx, userId: 'other', send() {} });
      await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'stale' }, f.ctx);
      expect(control.signal.aborted).toBe(false);
      await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'upload' }, f.ctx);
      expect(control.signal.aborted).toBe(true);
      expect(f.messages.some(m => m.type === 'import_progress' && m.phase === 'done')).toBe(false);
      f.gate.resolve(); await run;
      expect(f.deleted()).toBe(1);
      expect(f.messages.at(-1)).toMatchObject({ type: 'import_progress', phase: 'done', cancelled: true });
      expect(f.messages.some(m => m.type === 'error')).toBe(false);
    });
  }

  test('does not cancel once final saving starts', async () => {
    const f = fixture();
    const run = f.handlers.process_module_from_upload({ type: 'process_module_from_upload', uploadId: 'upload', fileName: 'module.risum' }, f.ctx);
    const control = await f.started.promise;
    control.beginSave();
    await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'upload' }, f.ctx);
    expect(control.signal.aborted).toBe(false);
    f.gate.resolve(); await run;
    expect(f.messages.at(-1)).toMatchObject({ type: 'import_progress', phase: 'done', message: 'Imported Example' });
  });
});


test('a late processing cancel cannot relabel a successful import', async () => {
  const f = fixture();
  const run = f.handlers.process_module_from_upload({ type: 'process_module_from_upload', uploadId: 'upload', fileName: 'module.risum' }, f.ctx);
  await f.started.promise; f.gate.resolve(); await run;
  const count = f.messages.length;
  await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'upload' }, f.ctx);
  expect(f.messages).toHaveLength(count);
  expect(f.messages.at(-1)).toMatchObject({ type: 'import_progress', phase: 'done', message: 'Imported Example' });
});

test('staged upload cancellation deletes and acknowledges the upload without processing it', async () => {
  const f = fixture();
  await f.handlers.cancel_module_import({ type: 'cancel_module_import', uploadId: 'upload', stagedUpload: true }, f.ctx);
  expect(f.deleted()).toBe(1);
  expect(f.messages.at(-1)).toMatchObject({ type: 'import_progress', phase: 'done', cancelled: true });
});
