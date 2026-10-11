import { expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { withStagedCard } from '../../src/core/charx/staged-reader.js';
import { stageBytes } from '../../src/host-services/files.js';
import { stagedHost } from '../helpers/staged-host.js';
import { buildStagedArchive } from '../../src/export/staged-archive.js';
import { crc32 } from '../../src/realm/import-formats/crc32.js';
import { PNG_SIGNATURE } from '../../src/realm/import-formats/png-chunks.js';

const card = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Example' } }));
test('PNG cards larger than 64 MiB retain embedded assets', async () => {
  function chunk(type: string, data: Uint8Array) {
    const raw = Buffer.concat([Buffer.from(type), data]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(raw));
    return Buffer.concat([header, raw, crc]);
  }
  const asset = Buffer.alloc(25 * 1024 ** 2, 123);
  const png = Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('tEXt', Buffer.from(`ccv3\0${Buffer.from(card).toString('base64')}`)),
    ...['a', 'b'].map(name => chunk('tEXt', Buffer.from(`chara-ext-asset_:${name}\0${asset.toString('base64')}`))),
    chunk('IEND', new Uint8Array()),
  ]);
  expect(png.length).toBeGreaterThan(64 * 1024 ** 2);
  const { host } = stagedHost();
  const source = await stageBytes(host.files, png, 'card.png', 'user');
  await withStagedCard(host, { fileId: source.fileId }, 'card.png', 'user', async prepared => {
    expect(prepared.bundle.assets.get('a')).toEqual(new Uint8Array(asset));
    expect(prepared.bundle.assets.get('b')).toEqual(new Uint8Array(asset));
  });
});
test.each([false, true])('staged import preserves metadata and asset bytes, polyglot=%s', async (polyglot) => {
  const { host, data, reads } = stagedHost();
  const zip = zipSync({ 'card.json': card, 'assets/image.png': Uint8Array.of(1, 2, 3) });
  const prefix = polyglot ? Uint8Array.of(0xff, 0xd8, 0xff, 0, 0, 0xff, 0xd9) : new Uint8Array();
  const file = await stageBytes(host.files, new Uint8Array([...prefix, ...zip]), 'card', 'user');
  await withStagedCard(host, { fileId: file.fileId }, 'card.charx', 'user', async prepared => {
    expect(prepared.bundle.cardJsonText).toBe(new TextDecoder().decode(card));
    expect(prepared.bundle.isPolyglot).toBe(polyglot);
    expect(prepared.bundle.assets.size).toBe(0);
    expect(reads.length).toBeGreaterThan(0);
    expect(await prepared.assets.get('assets/image.png')!.read()).toEqual(Uint8Array.of(1, 2, 3));
  });
  expect([...data.keys()]).toEqual([file.fileId]);
});

test('a 5 GiB asset collection stays deferred and cleanup runs on import failure', async () => {
  const { host, reads, data } = stagedHost();
  const source = await stageBytes(host.files, Uint8Array.of(0x50, 0x4b, 3, 4), 'source', 'user');
  const metadata = await stageBytes(host.files, card, 'card.json', 'user');
  host.archives.extract = async () => [{ name: 'card.json', file: metadata }, ...Array.from({ length: 128 }, (_, i) => ({
    name: `assets/${i}.png`, file: { fileId: `asset-${i}`, fileName: `${i}.png`, size: 40 * 1024 * 1024, mimeType: 'image/png' },
  }))];
  await expect(withStagedCard(host, { fileId: source.fileId }, 'large.charx', 'user', async prepared => {
    expect([...prepared.assets.values()].reduce((sum, asset) => sum + asset.byteLength, 0)).toBe(5 * 1024 ** 3);
    expect(reads.some(id => id.startsWith('asset-'))).toBe(false);
    throw new Error('Import refused');
  })).rejects.toThrow('Import refused');
  expect([...data.keys()]).toEqual([source.fileId]);
});

test('export reads original assets on the backend and keeps only the downloadable archive', async () => {
  const { host, images, data } = stagedHost();
  images.set('original', Uint8Array.of(0, 0x80, 0xff));
  const result = await buildStagedArchive(host, { fileName: 'export.charx', missingAssets: [], entries: [
    { kind: 'text', path: 'card.json', text: new TextDecoder().decode(card), level: 6 },
    { kind: 'image', path: 'assets/image.bin', metaPath: 'x_meta/image.json', imageId: 'original', level: 0 },
    { kind: 'image', path: 'missing.png', metaPath: 'x_meta/missing.json', imageId: 'missing', level: 0 },
  ] }, 'user');
  expect(result.skippedAssets).toEqual(['missing.png']);
  expect([...data.keys()]).toEqual([result.fileId]);
  await withStagedCard(host, { fileId: result.fileId }, result.fileName, 'user', async prepared => {
    expect(await prepared.assets.get('assets/image.bin')!.read()).toEqual(images.get('original')!);
    expect(prepared.bundle.xMeta.get('x_meta/image.json')).toEqual({ type: 'Unknown' });
  });
});
