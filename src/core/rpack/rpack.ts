import { TranslationError } from "../errors.js";
import { RPACK_MAP_BYTES } from "./rpack-map-data.js";

// HACK: table is inlined; fs-relative path breaks after bun bundle flattens the output.

let ENCODE_MAP: Uint8Array | null = null;
let DECODE_MAP: Uint8Array | null = null;

function loadMaps(): { encode: Uint8Array; decode: Uint8Array } {
  if (ENCODE_MAP && DECODE_MAP) return { encode: ENCODE_MAP, decode: DECODE_MAP };
  const raw = RPACK_MAP_BYTES;
  if (raw.byteLength !== 512) {
    throw new TranslationError(
      "rpack/bad_map",
      `rpack_map inline table must be 512 bytes, got ${raw.byteLength}`,
    );
  }
  const encode = new Uint8Array(raw.buffer, raw.byteOffset, 256);
  const decode = new Uint8Array(raw.buffer, raw.byteOffset + 256, 256);
  assertInversePermutation(encode, decode);
  ENCODE_MAP = encode;
  DECODE_MAP = decode;
  return { encode, decode };
}

function assertInversePermutation(encode: Uint8Array, decode: Uint8Array): void {
  for (let i = 0; i < 256; i++) {
    const e = encode[i]!;
    if (decode[e] !== i) {
      throw new TranslationError(
        "rpack/bad_map",
        `rpack maps are not inverse permutations at byte ${i}: encode[${i}]=${e}, decode[${e}]=${decode[e]}`,
      );
    }
  }
}

export function encodeRPack(data: Uint8Array): Uint8Array {
  const { encode } = loadMaps();
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = encode[data[i]!]!;
  return out;
}

export function decodeRPack(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  decodeRPackInto(data, out);
  return out;
}

export function decodeRPackInto(data: Uint8Array, out: Uint8Array, offset = 0): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + data.length > out.length) {
    throw new RangeError('RPack decode destination is too small');
  }
  const { decode } = loadMaps();
  for (let i = 0; i < data.length; i++) out[offset + i] = decode[data[i]!]!;
}
