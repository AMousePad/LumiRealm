import { afterEach, expect, test } from 'bun:test';
import { newUuid, setupUuid } from '../../src/util/uuid.js';
import { sha256Hex } from '../../src/util/sha256.js';
import { testUuid } from '../helpers/uuid-stub.js';

afterEach(() => setupUuid({ uuid: testUuid }));

test('newUuid draws from the host frontend UUID API', () => {
  setupUuid({ uuid: { v4: () => 'v4-id', v7: () => 'v7-id' } });
  expect(newUuid()).toBe('v7-id');
});

test('setupUuid fails loudly on a host without frontend UUIDs', () => {
  expect(() => setupUuid({})).toThrow('frontend-uuid-v1');
});

test('sha256Hex matches published vectors', () => {
  const hash = (text: string) => sha256Hex(new TextEncoder().encode(text));
  expect(hash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256Hex agrees with a reference implementation around block boundaries', () => {
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000, 70000]) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 31 + length) & 0xff);
    expect(sha256Hex(bytes)).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
  }
});
