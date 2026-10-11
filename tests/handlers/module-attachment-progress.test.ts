import { describe, expect, test, mock } from 'bun:test';
import { createModuleHandlers, type ModuleHandlerDeps } from '../../src/handlers/module.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

function build(overrides: Partial<ModuleHandlerDeps> = {}) {
  const progress = mock<ModuleHandlerDeps['emitOperationProgress']>(() => {});
  const deps = {
    attachModuleToCharacter: mock(async () => ({ ok: true })),
    pushAttachedForCharacter: mock(async () => {}),
    pushModules: mock(async () => {}),
    blockedByRepair: () => false,
    emitOperationProgress: progress,
    errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
    ...overrides,
  } as unknown as ModuleHandlerDeps;
  const ctx = {
    userId: 'user-1',
    send: mock((_message: BackendToFrontend, _userId?: string) => {}),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: deps.errMsg,
  };
  return { deps, ctx, progress, run: () => createModuleHandlers(deps).attach_module({ type: 'attach_module', characterId: 'card-1', moduleId: 'module-1' }, ctx) };
}

describe('module attachment progress', () => {
  test('shows progress while attachment is pending and finishes after the UI refresh', async () => {
    const attaching = Promise.withResolvers<{ ok: boolean }>();
    const refresh = Promise.withResolvers<void>();
    const { run, progress, ctx } = build({
      attachModuleToCharacter: () => attaching.promise,
      pushModules: () => refresh.promise,
    });
    const running = run();
    expect(progress.mock.calls.map(call => call[2])).toEqual(['started']);
    attaching.resolve({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(progress.mock.calls.map(call => call[2])).toEqual(['started', 'progress']);
    refresh.resolve();
    await running;
    expect(progress.mock.calls.map(call => call[2])).toEqual(['started', 'progress', 'done']);
    expect(new Set(progress.mock.calls.map(call => call[1])).size).toBe(1);
    expect(progress.mock.calls.every(call => call[0] === 'user-1')).toBe(true);
    expect(ctx.send).not.toHaveBeenCalled();
  });

  test.each(['rejected', 'throws', 'refresh'] as const)('ends progress with an error when %s', async (failure) => {
    const { run, progress, ctx } = build({
      attachModuleToCharacter: async () => {
        if (failure === 'throws') throw new Error('Attachment unavailable');
        return failure === 'rejected' ? { ok: false, reason: 'Missing module' } : { ok: true };
      },
      pushModules: async () => { if (failure === 'refresh') throw new Error('Refresh failed'); },
    });
    await run();
    expect(progress.mock.calls.at(-1)?.[2]).toBe('error');
    expect(progress.mock.calls.some(call => call[2] === 'done')).toBe(false);
    expect(ctx.send).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('attach_module:') }, 'user-1');
  });

  test('does not start a progress overlay when repair blocks attachment', async () => {
    const { run, progress, deps } = build({ blockedByRepair: () => true });
    await run();
    expect(progress).not.toHaveBeenCalled();
    expect(deps.attachModuleToCharacter).not.toHaveBeenCalled();
  });
});
