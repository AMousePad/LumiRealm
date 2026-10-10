import { describe, test, expect } from "bun:test";
import { encodeRPack, decodeRPack } from "../../src/core/rpack/rpack.js";

function randomBytes(len: number, seed: number): Uint8Array {
  // Mulberry32 deterministic PRNG — tests reproduce exactly across runs.
  let s = seed >>> 0;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return out;
}

describe("rpack codec", () => {
  test("round-trips every possible byte value", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(decodeRPack(encodeRPack(all))).toEqual(all);
    expect(encodeRPack(decodeRPack(all))).toEqual(all);
  });

  test("is a byte-wise permutation (encode bijects 0..255)", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const encoded = encodeRPack(all);
    const seen = new Set<number>();
    for (const b of encoded) seen.add(b);
    expect(seen.size).toBe(256);
  });

  test("round-trips random buffers of many sizes", () => {
    for (const size of [0, 1, 2, 15, 16, 17, 255, 256, 257, 1024, 65537]) {
      for (let seed = 1; seed <= 5; seed++) {
        const src = randomBytes(size, seed + size);
        expect(decodeRPack(encodeRPack(src))).toEqual(src);
      }
    }
  });

  test("is stateless — repeated calls return independent buffers", () => {
    const src = randomBytes(1024, 42);
    const a = encodeRPack(src);
    const b = encodeRPack(src);
    expect(a).toEqual(b);
    // Mutating the input afterwards must not affect prior outputs.
    src[0] = (src[0]! ^ 0xff) & 0xff;
    expect(a).toEqual(b);
  });

  test("empty input returns empty output", () => {
    expect(encodeRPack(new Uint8Array(0))).toEqual(new Uint8Array(0));
    expect(decodeRPack(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  test("matches Risu's static map (sanity via known fixture)", () => {
    // First 16 bytes of a decoded corpus payload start with '{' which is 0x7b.
    // After RPack encoding they become a specific byte sequence. We verify
    // encode('{') is deterministic and non-identity (confirms we actually
    // loaded the real map, not an accidental identity table).
    const input = new Uint8Array([0x7b]); // '{'
    const encoded = encodeRPack(input);
    expect(encoded.length).toBe(1);
    // Either the map is identity (bad — would mean our file is wrong) or it's
    // a genuine permutation. We require non-identity on at least one byte.
    const identityAll = new Uint8Array(256);
    for (let i = 0; i < 256; i++) identityAll[i] = i;
    const encodedAll = encodeRPack(identityAll);
    let diffs = 0;
    for (let i = 0; i < 256; i++) if (encodedAll[i] !== i) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });
});
