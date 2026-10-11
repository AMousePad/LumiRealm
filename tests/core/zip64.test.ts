import { expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { readZip } from '../../src/core/charx/zip.js';

test.each([false, true])('reads ZIP64 exports with JPEG prefix=%s', (polyglot) => {
  const content = Uint8Array.of(0, 128, 255);
  const zip = zipSync({ 'asset.bin': content });
  const end = zip.length - 22;
  const original = new DataView(zip.buffer);
  const records = new Uint8Array(76);
  const view = new DataView(records.buffer);
  view.setUint32(0, 0x06064b50, true);
  view.setBigUint64(4, 44n, true);
  view.setBigUint64(24, 1n, true);
  view.setBigUint64(32, 1n, true);
  view.setBigUint64(40, BigInt(original.getUint32(end + 12, true)), true);
  view.setBigUint64(48, BigInt(original.getUint32(end + 16, true)), true);
  view.setUint32(56, 0x07064b50, true);
  view.setBigUint64(64, BigInt(end), true);
  view.setUint32(72, 1, true);
  const prefix = polyglot ? Uint8Array.of(0xff, 0xd8, 0xff, 0, 0, 0xff, 0xd9) : new Uint8Array();
  const bytes = new Uint8Array(prefix.length + zip.length + records.length);
  bytes.set(prefix);
  bytes.set(zip.subarray(0, end), prefix.length);
  bytes.set(records, prefix.length + end);
  bytes.set(zip.subarray(end), prefix.length + end + records.length);
  const result = readZip(bytes, { maxEntryBytes: 1024, maxTotalBytes: 1024, maxEntryCount: 10 });
  expect(result.entries).toEqual([{ name: 'asset.bin', data: content }]);
});
