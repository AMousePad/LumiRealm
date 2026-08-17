import { afterEach, describe, expect, test } from 'bun:test';

import {
  createOrphanDetectBuilders,
  type OrphanDetectBuildersDeps,
} from './orphan-detect-builders.js';

interface ImagesStub {
  delete(id: string, userId?: string): Promise<boolean>;
  deleteMany(ids: string[], options?: { userId?: string }): Promise<number>;
}

function setImages(images: ImagesStub): void {
  (globalThis as { spindle?: unknown }).spindle = { images };
}

function createBuilders(warns: string[] = []) {
  const deps: OrphanDetectBuildersDeps = {
    journalStorage: () => ({}) as never,
    listLumirealmCharacters: async () => [],
    listModuleStore: async () => [],
    readModuleEnvelope: async () => null,
    log: { info: () => {}, warn: (message) => warns.push(message) },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  };
  return createOrphanDetectBuilders(deps);
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('deleteImageIds', () => {
  test('bulk deletes more than one image in 500-item batches', async () => {
    const bulkCalls: Array<{ ids: string[]; userId: string | undefined }> = [];
    let singleCalls = 0;
    setImages({
      delete: async () => { singleCalls++; return true; },
      deleteMany: async (ids, options) => {
        bulkCalls.push({ ids, userId: options?.userId });
        return Math.max(0, ids.length - 1);
      },
    });
    const progress: Array<[number, number]> = [];
    const ids = Array.from({ length: 1001 }, (_, index) => `image-${index}`);

    const result = await createBuilders().deleteImageIds(
      ids,
      'user-1',
      'bulk-test',
      (processed, total) => progress.push([processed, total]),
    );

    expect(bulkCalls.map((call) => call.ids.length)).toEqual([500, 500, 1]);
    expect(bulkCalls.every((call) => call.userId === 'user-1')).toBe(true);
    expect(singleCalls).toBe(0);
    expect(result).toEqual({ deleted: 998, absent: 3, failed: 0 });
    expect(progress).toEqual([[500, 1001], [1000, 1001], [1001, 1001]]);
  });

  test('uses single delete for one image and preserves deleted and absent counts', async () => {
    const singleCalls: Array<{ id: string; userId: string | undefined }> = [];
    const responses = [true, false];
    let bulkCalls = 0;
    setImages({
      delete: async (id, userId) => {
        singleCalls.push({ id, userId });
        return responses.shift() ?? false;
      },
      deleteMany: async () => { bulkCalls++; return 0; },
    });
    const progress: Array<[number, number]> = [];
    const builders = createBuilders();

    const deleted = await builders.deleteImageIds(
      ['present'],
      'user-1',
      'single-test',
      (processed, total) => progress.push([processed, total]),
    );
    const absent = await builders.deleteImageIds(
      ['missing'],
      'user-1',
      'single-test',
      (processed, total) => progress.push([processed, total]),
    );

    expect(singleCalls).toEqual([
      { id: 'present', userId: 'user-1' },
      { id: 'missing', userId: 'user-1' },
    ]);
    expect(bulkCalls).toBe(0);
    expect(deleted).toEqual({ deleted: 1, absent: 0, failed: 0 });
    expect(absent).toEqual({ deleted: 0, absent: 1, failed: 0 });
    expect(progress).toEqual([[1, 1], [1, 1]]);
  });

  test('counts a failed bulk batch and still reports progress', async () => {
    const warns: string[] = [];
    setImages({
      delete: async () => true,
      deleteMany: async () => { throw new Error('bulk failed'); },
    });
    const progress: Array<[number, number]> = [];

    const result = await createBuilders(warns).deleteImageIds(
      ['a', 'b', 'c'],
      'user-1',
      'bulk-error',
      (processed, total) => progress.push([processed, total]),
    );

    expect(result).toEqual({ deleted: 0, absent: 0, failed: 3 });
    expect(progress).toEqual([[3, 3]]);
    expect(warns).toEqual(['bulk-error: bulk image delete threw (3 ids): bulk failed']);
  });

  test('counts a failed single delete and contains progress callback errors', async () => {
    const warns: string[] = [];
    setImages({
      delete: async () => { throw new Error('single failed'); },
      deleteMany: async () => 0,
    });

    const result = await createBuilders(warns).deleteImageIds(
      ['a'],
      'user-1',
      'single-error',
      () => { throw new Error('progress failed'); },
    );

    expect(result).toEqual({ deleted: 0, absent: 0, failed: 1 });
    expect(warns).toEqual([
      'single-error: image delete threw id=a: single failed',
      'single-error: onProgress threw: progress failed',
    ]);
  });
});
