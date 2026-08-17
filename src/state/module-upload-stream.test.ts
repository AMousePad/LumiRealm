import { describe, expect, test } from 'bun:test';
import type { RisuModule } from '../core/schemas/module.js';
import {
  createModuleUploader,
  type ImageUploadInput,
  type ModuleUploaderDeps,
} from './module-upload.js';

function moduleBody(assetNames: readonly string[]): RisuModule {
  return {
    id: 'source-id',
    name: 'Stream Test',
    assets: assetNames.map((name) => [name, '', '']),
  } as unknown as RisuModule;
}

function uploader(body: RisuModule, uploadMany: boolean) {
  const batches: number[] = [];
  let uploadedOne = 0;
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
    ...(uploadMany ? {
      uploadImageMany: async (items: readonly ImageUploadInput[]) => {
        batches.push(items.length);
        return items.map((_, index) => ({ id: `batch-${batches.length}-${index}` }));
      },
    } : {}),
    appendToJournal: async () => {},
    syncWorldBook: async () => null,
    writeEnvelope: async () => {},
    emitProgress: () => {},
    currentTranslatorSchemaVersion: 1,
    log: { info: () => {}, warn: () => {} },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  };
  return { value: createModuleUploader(deps), batches, uploadedOne: () => uploadedOne };
}

describe('ModuleUploader.uploadSource', () => {
  test('reads a sequential source in order without overlap', async () => {
    const { value, uploadedOne } = uploader(moduleBody(['a', 'b', 'c']), false);
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
    expect(uploadedOne()).toBe(3);
  });

  test('carries a consumed asset across the 16 MiB batch boundary', async () => {
    const { value, batches } = uploader(moduleBody(['large', 'small']), true);
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
});
