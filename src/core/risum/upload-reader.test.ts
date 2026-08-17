import { describe, expect, test } from 'bun:test';
import { decodeRisum, encodeRisum } from './codec.js';
import { openRisumUpload, type UploadChunk } from './upload-reader.js';

function readInChunks(bytes: Uint8Array, chunkSize: number) {
  return async (offset: number): Promise<UploadChunk | null> => {
    if (offset < 0 || offset > bytes.length) return null;
    const end = Math.min(bytes.length, offset + chunkSize);
    return {
      fileName: 'test.risum',
      size: bytes.length,
      offset,
      data: bytes.slice(offset, end),
      eof: end === bytes.length,
    };
  };
}

describe('openRisumUpload', () => {
  test('matches the whole-file decoder across tiny chunk boundaries', async () => {
    const assets = [
      Uint8Array.from([0, 1, 2, 3, 254, 255]),
      Uint8Array.from({ length: 31 }, (_, i) => (i * 17) & 0xff),
    ];
    const bytes = encodeRisum({
      module: {
        id: 'module-1',
        name: 'Chunk Test',
        assets: [['a.bin', '', ''], ['b.bin', '', '']],
      },
      assets,
    });
    const expected = decodeRisum(bytes);
    const source = await openRisumUpload(readInChunks(bytes, 3));

    expect(source.module).toEqual(expected.module);
    expect(await source.readAsset(0)).toEqual(expected.assets[0]);
    expect(await source.readAsset(1)).toEqual(expected.assets[1]);
    expect(await source.finish()).toBe(2);
  });

  test('skips an unreferenced earlier asset without allocating it', async () => {
    const assets = [new Uint8Array(50_000).fill(7), Uint8Array.from([9, 8, 7])];
    const bytes = encodeRisum({
      module: { id: 'module-2', assets: [['skip.bin', '', ''], ['keep.bin', '', '']] },
      assets,
    });
    const source = await openRisumUpload(readInChunks(bytes, 11));

    expect(await source.readAsset(1)).toEqual(assets[1]);
    await expect(source.readAsset(0)).rejects.toThrow(/must be read in order/);
    expect(await source.finish()).toBe(2);
  });

  test('finish rejects trailing bytes', async () => {
    const encoded = encodeRisum({ module: { id: 'module-3' } });
    const bytes = new Uint8Array(encoded.length + 1);
    bytes.set(encoded);
    bytes[bytes.length - 1] = 42;
    const source = await openRisumUpload(readInChunks(bytes, 5));

    await expect(source.finish()).rejects.toThrow(/unexpected bytes/);
  });

  test('accepts EOF without an explicit end marker like decodeRisum', async () => {
    const encoded = encodeRisum({ module: { id: 'module-4' } });
    const bytes = encoded.slice(0, -1);
    expect(decodeRisum(bytes).assets).toEqual([]);

    const source = await openRisumUpload(readInChunks(bytes, 2));
    expect(await source.finish()).toBe(0);
  });
});
