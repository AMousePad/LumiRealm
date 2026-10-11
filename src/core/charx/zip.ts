import { inflateRawSync } from "node:zlib";
import { TranslationError } from "../errors.js";
import { findJpegZipBoundary } from './polyglot.js';


export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ZipReadResult {
  readonly entries: readonly ZipEntry[];
  readonly oversized: readonly { name: string; uncompressedSize: number }[];
}

export interface ReadZipOptions {
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxEntryCount: number;
}


const SIG_EOCD = 0x06054b50; // PK\x05\x06
const SIG_EOCD64_LOCATOR = 0x07064b50; // PK\x06\x07
const SIG_EOCD64 = 0x06064b50; // PK\x06\x06
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_LOCAL = 0x04034b50; // PK\x03\x04
const EOCD_MAX_COMMENT = 65535;

function findEocd(bytes: Uint8Array): number {
  const from = Math.max(0, bytes.length - EOCD_MAX_COMMENT - 22);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (readU32(bytes, i) === SIG_EOCD) return i;
  }
  throw new TranslationError("zip/no_eocd", "end-of-central-directory record not found");
}

function resolveCentralDirectory(
  bytes: Uint8Array,
  eocdOff: number,
): { cdOffset: number; cdSize: number; cdCount: number; prefixDelta: number } {
  let cdSize = readU32(bytes, eocdOff + 12);
  let storedCdOffset = readU32(bytes, eocdOff + 16);
  let cdCount = readU16(bytes, eocdOff + 10);
  // ZIP64 locator sits at eocdOff - 20.
  const locOff = eocdOff - 20;
  let cdEnd = eocdOff;
  if (locOff >= 0 && readU32(bytes, locOff) === SIG_EOCD64_LOCATOR) {
    let eocd64Off = Number(readU64(bytes, locOff + 8));
    if (readU32(bytes, eocd64Off) !== SIG_EOCD64) {
      const prefix = findJpegZipBoundary(bytes);
      if (prefix > 0) eocd64Off += prefix;
    }
    if (eocd64Off >= 0 && eocd64Off + 56 <= bytes.length && readU32(bytes, eocd64Off) === SIG_EOCD64) {
      cdEnd = eocd64Off;
      cdCount = Number(readU64(bytes, eocd64Off + 32));
      cdSize = Number(readU64(bytes, eocd64Off + 40));
      storedCdOffset = Number(readU64(bytes, eocd64Off + 48));
    }
  }
  const realCdOffset = cdEnd - cdSize;
  const prefixDelta = realCdOffset - storedCdOffset;
  return { cdOffset: realCdOffset, cdSize, cdCount, prefixDelta };
}


interface CdRecord {
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly nameBytes: Uint8Array;
  readonly localHeaderOffset: number;
  readonly utf8: boolean;
}

function parseCentralDirectory(
  bytes: Uint8Array,
  cdOff: number,
  cdSize: number,
  cdCount: number,
  prefixDelta: number,
): CdRecord[] {
  const records: CdRecord[] = [];
  let p = cdOff;
  const end = cdOff + cdSize;
  for (let i = 0; i < cdCount && p < end; i++) {
    if (readU32(bytes, p) !== SIG_CENTRAL) {
      throw new TranslationError("zip/bad_cd", `central directory record ${i} has wrong signature at offset ${p}`);
    }
    const flags = readU16(bytes, p + 8);
    const method = readU16(bytes, p + 10);
    let compressedSize = readU32(bytes, p + 20);
    let uncompressedSize = readU32(bytes, p + 24);
    const nameLen = readU16(bytes, p + 28);
    const extraLen = readU16(bytes, p + 30);
    const commentLen = readU16(bytes, p + 32);
    let localHeaderOffset = readU32(bytes, p + 42);

    const nameStart = p + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
    const extraStart = nameStart + nameLen;

    if (extraLen > 0) {
      let ex = extraStart;
      const exEnd = extraStart + extraLen;
      while (ex + 4 <= exEnd) {
        const tag = readU16(bytes, ex);
        const len = readU16(bytes, ex + 2);
        const dataStart = ex + 4;
        if (tag === 0x0001) {
          // ZIP64: each 64-bit field present only if corresponding 32-bit was 0xFFFFFFFF.
          let q = dataStart;
          if (uncompressedSize === 0xFFFFFFFF && q + 8 <= dataStart + len) {
            uncompressedSize = Number(readU64(bytes, q)); q += 8;
          }
          if (compressedSize === 0xFFFFFFFF && q + 8 <= dataStart + len) {
            compressedSize = Number(readU64(bytes, q)); q += 8;
          }
          if (localHeaderOffset === 0xFFFFFFFF && q + 8 <= dataStart + len) {
            localHeaderOffset = Number(readU64(bytes, q)); q += 8;
          }
          break;
        }
        ex = dataStart + len;
      }
    }

    const utf8 = (flags & 0x0800) !== 0;
    records.push({
      method,
      compressedSize,
      uncompressedSize,
      nameBytes,
      localHeaderOffset: localHeaderOffset + prefixDelta,
      utf8,
    });
    p = extraStart + extraLen + commentLen;
  }
  return records;
}


function dataOffsetFor(bytes: Uint8Array, rec: CdRecord): number {
  const lfhOff = rec.localHeaderOffset;
  if (readU32(bytes, lfhOff) !== SIG_LOCAL) {
    throw new TranslationError(
      "zip/bad_lfh",
      `local file header missing signature at offset ${lfhOff}`,
    );
  }
  const nameLen = readU16(bytes, lfhOff + 26);
  const extraLen = readU16(bytes, lfhOff + 28);
  return lfhOff + 30 + nameLen + extraLen;
}

function decompress(bytes: Uint8Array, rec: CdRecord, dataOff: number): Uint8Array {
  const compressed = bytes.subarray(dataOff, dataOff + rec.compressedSize);
  if (rec.method === 0) {
    return Uint8Array.from(compressed);
  }
  if (rec.method === 8) {
    return new Uint8Array(inflateRawSync(compressed));
  }
  throw new TranslationError(
    "zip/unsupported_method",
    `unsupported compression method ${rec.method} for entry`,
  );
}


export function readZip(bytes: Uint8Array, opts: ReadZipOptions): ZipReadResult {
  const eocd = findEocd(bytes);
  const { cdOffset, cdSize, cdCount, prefixDelta } = resolveCentralDirectory(bytes, eocd);
  if (cdCount > opts.maxEntryCount) {
    throw new TranslationError(
      "zip/too_many_entries",
      `zip contains ${cdCount} entries, exceeds limit ${opts.maxEntryCount}`,
    );
  }
  const records = parseCentralDirectory(bytes, cdOffset, cdSize, cdCount, prefixDelta);

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const cp437 = cp437Decoder(); // fallback for non-UTF8-flagged names

  const entries: ZipEntry[] = [];
  const oversized: { name: string; uncompressedSize: number }[] = [];

  // Pre-sum declared sizes before any inflation: bomb stops before any RAM is allocated.
  let plannedTotal = 0;
  for (const rec of records) {
    if (rec.uncompressedSize > opts.maxEntryBytes) continue; // will be oversized-skipped
    plannedTotal += rec.uncompressedSize;
    if (plannedTotal > opts.maxTotalBytes) {
      throw new TranslationError(
        "zip/total_size_exceeded",
        `declared decompressed size ${plannedTotal} exceeds limit ${opts.maxTotalBytes} bytes`,
      );
    }
  }

  let totalBytes = 0;
  for (const rec of records) {
    const name = rec.utf8 ? decoder.decode(rec.nameBytes) : cp437(rec.nameBytes);
    if (rec.uncompressedSize > opts.maxEntryBytes) {
      oversized.push({ name, uncompressedSize: rec.uncompressedSize });
      continue;
    }
    const dataOff = dataOffsetFor(bytes, rec);
    const data = decompress(bytes, rec, dataOff);
    totalBytes += data.byteLength;
    // Belt-and-suspenders: catch spoofed CD size at runtime.
    if (totalBytes > opts.maxTotalBytes) {
      throw new TranslationError(
        "zip/total_size_exceeded",
        `actual decompressed size ${totalBytes} exceeds limit ${opts.maxTotalBytes} bytes`,
      );
    }
    entries.push({ name, data });
  }
  return { entries, oversized };
}


function readU16(b: Uint8Array, p: number): number {
  return b[p]! | (b[p + 1]! << 8);
}
function readU32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
}
function readU64(b: Uint8Array, p: number): bigint {
  let lo = 0n; let hi = 0n;
  for (let i = 0; i < 4; i++) lo |= BigInt(b[p + i]!) << BigInt(i * 8);
  for (let i = 0; i < 4; i++) hi |= BigInt(b[p + 4 + i]!) << BigInt(i * 8);
  return (hi << 32n) | lo;
}

function cp437Decoder(): (bytes: Uint8Array) => string {
  const table = CP437_UPPER;
  return (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i]!;
      s += c < 0x80 ? String.fromCharCode(c) : table[c - 0x80]!;
    }
    return s;
  };
}

const CP437_UPPER: readonly string[] = (
  "ÇüéâäàåçêëèïîìÄÅ" +   // 0x80
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +   // 0x90
  "áíóúñÑªº¿⌐¬½¼¡«»" +   // 0xA0
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +   // 0xB0
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +   // 0xC0
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +   // 0xD0
  "αßΓπΣσµτΦΘΩδ∞φε∩" +   // 0xE0
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "    // 0xF0 (last is NBSP)
).split("");
