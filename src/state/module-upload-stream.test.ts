import { describe, expect, test } from 'bun:test';
import type { RisuModule } from '../core/schemas/module.js';
import {
  createModuleUploader,
  type ModuleUploaderDeps,
} from './module-upload.js';

function moduleBody(assetNames: readonly string[]): RisuModule {
  return {
    id: 'source-id',
    name: 'Stream Test',
    assets: assetNames.map((name) => [name, '', '']),
  } as unknown as RisuModule;
}

function uploader(
  body: RisuModule,
  uploadMany: ModuleUploaderDeps['uploadImageMany'] = async (items) =>
    items.map((_, index) => ({ id: `batch-${index}` })),
) {
  const batches: number[] = [];
  let uploadedOne = 0;
  const journaled: string[][] = [];
  const warns: string[] = [];
  const deps: ModuleUploaderDeps = {
    decodeRisum: () => { throw new Error('unused'); },
    decodeCharx: () => { throw new Error('unused'); },
    parseSchema: () => ({ success: true, data: body }),
    newUuid: () => 'new-id',
    requestConsent: async () => ({ confirmed: true }),
    pairAssets: () => [],
    guessMimeType: () => 'application/octet-stream',
    sniffImageMime: () => null,
    uploadImageOne: async () => ({ id: `one-${++uploadedOne}` }),
    uploadImageMany: async (items, opts) => {
      batches.push(items.length);
      return uploadMany(items, opts);
    },
    appendToJournal: async (_userId, _moduleId, ids) => { journaled.push([...ids]); },
    syncWorldBook: async () => null,
    writeEnvelope: async () => {},
    emitProgress: () => {},
    currentTranslatorSchemaVersion: 1,
    log: { info: () => {}, warn: (message) => { warns.push(message); } },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  };
  return { value: createModuleUploader(deps), batches, journaled, warns, uploadedOne: () => uploadedOne };
}

describe('ModuleUploader.uploadSource', () => {
  test('reads a sequential source in order without overlap', async () => {
    const { value, batches, uploadedOne } = uploader(moduleBody(['a', 'b', 'c']));
    const indexes: number[] = [];
    let active = 0;
    let maxActive = 0;

    await value.uploadSource({
      module: {},
      assetCount: 3,
      concurrentReads: false,
      async readAsset(index) {
        indexes.push(index);
        active++;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(1);
        active--;
        return Uint8Array.of(index);
      },
      async finish() { return 3; },
    }, 'large.risum', 'user-1');

    expect(indexes).toEqual([0, 1, 2]);
    expect(maxActive).toBe(1);
    expect(batches).toEqual([3]);
    expect(uploadedOne()).toBe(0);
  });

  test('carries a consumed asset across the 16 MiB batch boundary', async () => {
    const { value, batches } = uploader(moduleBody(['large', 'small']));
    const assets = [new Uint8Array(16 * 1024 * 1024), Uint8Array.of(1)];
    const indexes: number[] = [];

    await value.uploadSource({
      module: {},
      assetCount: assets.length,
      concurrentReads: false,
      async readAsset(index) {
        indexes.push(index);
        return assets[index];
      },
      async finish() { return assets.length; },
    }, 'large.risum', 'user-1');

    expect(indexes).toEqual([0, 1]);
    expect(batches).toEqual([1, 1]);
  });

  test('keeps successful assets when a batch item fails', async () => {
    const { value, journaled, warns } = uploader(
      moduleBody(['ok', 'bad']),
      async () => [{ id: 'image-ok' }, { error: 'failed' }],
    );

    const result = await value.uploadSource({
      module: {},
      assetCount: 2,
      async readAsset(index) { return Uint8Array.of(index); },
    }, 'module.risum', 'user-1');

    expect(result.envelope.asset_index).toEqual({ ok: { imageId: 'image-ok' } });
    expect(journaled).toEqual([['image-ok']]);
    expect(warns.some((message) => message.includes('upload failed name=bad'))).toBe(true);
  });

  test('keeps the module when a batch upload throws', async () => {
    const { value, journaled, warns } = uploader(
      moduleBody(['a', 'b']),
      async () => { throw new Error('network'); },
    );

    const result = await value.uploadSource({
      module: {},
      assetCount: 2,
      async readAsset(index) { return Uint8Array.of(index); },
    }, 'module.risum', 'user-1');

    expect(result.envelope.asset_index).toEqual({});
    expect(journaled).toEqual([]);
    expect(warns.filter((message) => message.includes('upload failed name='))).toHaveLength(2);
  });

  test('uploads and journals the module icon through the single-image API', async () => {
    const { value, journaled, uploadedOne } = uploader(moduleBody([]));

    const result = await value.uploadSource({
      module: {},
      assetCount: 0,
      icon: { data: Uint8Array.of(1), ext: 'png' },
      async readAsset() { return undefined; },
    }, 'module.risum', 'user-1');

    expect(result.envelope.module.icon).toBe('one-1');
    expect(uploadedOne()).toBe(1);
    expect(journaled).toEqual([['one-1']]);
  });
});
