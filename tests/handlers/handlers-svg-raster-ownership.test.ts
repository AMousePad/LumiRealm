import { describe, expect, test } from 'bun:test';
import { createImportHandlers, type ImportHandlerDeps } from '../../src/handlers/import.js';

interface Call { type: string; [k: string]: unknown }

function makeHarness(opts: {
  pending?: { ownerUserId: string };
  owned: boolean;
}) {
  const applied: unknown[] = [];
  const finalized: string[] = [];
  const sent: Call[] = [];
  const pendingImportCompletions = new Map<string, {
    hasPendingSvgRaster: boolean;
    characterName: string;
    startedAt: number;
    ownerUserId: string;
  }>();
  if (opts.pending) {
    pendingImportCompletions.set('char-1', {
      hasPendingSvgRaster: true,
      characterName: 'Card',
      startedAt: Date.now(),
      ownerUserId: opts.pending.ownerUserId,
    });
  }
  const deps = {
    pendingImportCompletions,
    characterGet: async () => (opts.owned ? { name: 'Card' } : null),
    applySvgRasterIndex: async (args: unknown) => { applied.push(args); },
    maybeFinalizeImport: async (charId: string) => { finalized.push(charId); },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: (e: unknown) => String(e),
  } as unknown as ImportHandlerDeps;
  const handlers = createImportHandlers(deps);
  const ctx = {
    userId: 'user-1',
    send: (msg: Call) => { sent.push(msg); },
  };
  return { handlers, ctx, applied, finalized, sent, pendingImportCompletions };
}

const MSG = {
  type: 'register_svg_raster_index' as const,
  characterId: 'char-1',
  imageIdByMarker: { '0': 'img-a' },
};

describe('register_svg_raster_index ownership gate', () => {
  test('no pending import but sender owns character: applies without finalize', async () => {
    const h = makeHarness({ owned: true });
    await h.handlers.register_svg_raster_index(MSG as never, h.ctx as never);
    expect(h.applied.length).toBe(1);
    expect(h.finalized.length).toBe(0);
    expect(h.sent.filter((m) => m.type === 'error').length).toBe(0);
  });

  test('no pending import and sender does not own character: rejected', async () => {
    const h = makeHarness({ owned: false });
    await h.handlers.register_svg_raster_index(MSG as never, h.ctx as never);
    expect(h.applied.length).toBe(0);
    expect(h.sent.filter((m) => m.type === 'error').length).toBe(1);
  });

  test('pending import owned by sender: applies and finalizes', async () => {
    const h = makeHarness({ pending: { ownerUserId: 'user-1' }, owned: true });
    await h.handlers.register_svg_raster_index(MSG as never, h.ctx as never);
    expect(h.applied.length).toBe(1);
    expect(h.finalized).toEqual(['char-1']);
    expect(h.pendingImportCompletions.get('char-1')?.hasPendingSvgRaster).toBe(false);
  });

  test('pending import owned by another user: rejected', async () => {
    const h = makeHarness({ pending: { ownerUserId: 'user-2' }, owned: true });
    await h.handlers.register_svg_raster_index(MSG as never, h.ctx as never);
    expect(h.applied.length).toBe(0);
    expect(h.finalized.length).toBe(0);
    expect(h.sent.filter((m) => m.type === 'error').length).toBe(1);
  });
});
