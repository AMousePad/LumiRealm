import { decodeRPack, encodeRPack } from "../rpack/rpack.js";
import { TranslationError } from "../errors.js";

export const RISUM_MAGIC = 0x6f;
export const RISUM_VERSION = 0x00;
export const RISUM_MARK_ASSET = 0x01;
export const RISUM_MARK_END = 0x00;

export interface RisumEnvelope {
  readonly version: number;
  readonly module: unknown;
  readonly assets: readonly Uint8Array[];
  readonly payloadText: string;
}

export interface RisumPayloadWrapper {
  readonly type: "risuModule";
  readonly module: unknown;
}

export interface DecodeOptions {
  readonly maxPayloadBytes?: number;
  readonly maxAssetBytes?: number;
  readonly maxAssetCount?: number;
  readonly strictJson?: boolean;
}

export const DEFAULT_MAX_PAYLOAD_BYTES = 1 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_ASSET_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_ASSET_COUNT = 262144;

class Cursor {
  private offset = 0;
  constructor(private readonly buf: Uint8Array) {}

  get pos(): number { return this.offset; }
  get remaining(): number { return this.buf.length - this.offset; }
  get atEnd(): boolean { return this.offset >= this.buf.length; }

  readU8(label: string): number {
    this.requireBytes(1, label);
    const b = this.buf[this.offset]!;
    this.offset += 1;
    return b;
  }

  readU32LE(label: string): number {
    this.requireBytes(4, label);
    const b0 = this.buf[this.offset]!;
    const b1 = this.buf[this.offset + 1]!;
    const b2 = this.buf[this.offset + 2]!;
    const b3 = this.buf[this.offset + 3]!;
    this.offset += 4;
    // Unsigned, little-endian; >>> 0 forces unsigned 32-bit interpretation.
    return ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0);
  }

  readSlice(len: number, label: string): Uint8Array {
    if (len < 0 || !Number.isInteger(len)) {
      throw new TranslationError("risum/bad_length", `${label}: length ${len} is not a non-negative integer`);
    }
    this.requireBytes(len, label);
    const out = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  private requireBytes(n: number, label: string): void {
    if (this.buf.length - this.offset < n) {
      throw new TranslationError(
        "risum/truncated",
        `${label}: need ${n} bytes at offset ${this.offset}, only ${this.buf.length - this.offset} remain`,
      );
    }
  }
}

function assertUtf8(bytes: Uint8Array): string {
  // Bun/Node both throw on invalid UTF-8 with fatal:true.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  try {
    return decoder.decode(bytes);
  } catch (cause) {
    throw new TranslationError("risum/invalid_utf8", "RPack-decoded payload is not valid UTF-8", { cause });
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new TranslationError("risum/invalid_json", "RPack-decoded payload is not valid JSON", { cause });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function decodeRisum(buf: Uint8Array, opts: DecodeOptions = {}): RisumEnvelope {
  const maxPayload = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const maxAsset = opts.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  const maxAssetCount = opts.maxAssetCount ?? DEFAULT_MAX_ASSET_COUNT;

  const cur = new Cursor(buf);

  const magic = cur.readU8("magic");
  if (magic !== RISUM_MAGIC) {
    throw new TranslationError(
      "risum/bad_magic",
      `expected magic 0x${RISUM_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }
  const version = cur.readU8("version");
  if (version !== RISUM_VERSION) {
    throw new TranslationError("risum/unsupported_version", `unsupported risum version ${version}`);
  }

  const payloadLen = cur.readU32LE("payload_length");
  if (payloadLen > maxPayload) {
    throw new TranslationError(
      "risum/payload_too_large",
      `payload is ${payloadLen} bytes, exceeds limit ${maxPayload}`,
    );
  }
  const encodedPayload = cur.readSlice(payloadLen, "payload");
  const decodedPayload = decodeRPack(encodedPayload);
  const payloadText = assertUtf8(decodedPayload);
  const wrapper = parseJson(payloadText);

  if (!isPlainObject(wrapper)) {
    throw new TranslationError("risum/bad_wrapper", "payload JSON is not an object");
  }
  if (wrapper["type"] !== "risuModule") {
    throw new TranslationError(
      "risum/bad_wrapper",
      `payload type is ${JSON.stringify(wrapper["type"])}, expected "risuModule"`,
    );
  }
  const module = wrapper["module"];
  if (!isPlainObject(module)) {
    throw new TranslationError("risum/bad_wrapper", "payload.module is not an object");
  }

  const assets: Uint8Array[] = [];
  while (!cur.atEnd) {
    const mark = cur.readU8(`asset[${assets.length}].mark`);
    if (mark === RISUM_MARK_END) {
      // Trailing bytes after end-mark are invalid.
      if (!cur.atEnd) {
        throw new TranslationError(
          "risum/trailing_bytes",
          `${cur.remaining} unexpected bytes after end-of-file marker`,
        );
      }
      break;
    }
    if (mark !== RISUM_MARK_ASSET) {
      throw new TranslationError(
        "risum/bad_mark",
        `asset[${assets.length}]: expected mark 0x00 or 0x01, got 0x${mark.toString(16)}`,
      );
    }
    if (assets.length >= maxAssetCount) {
      throw new TranslationError(
        "risum/too_many_assets",
        `asset count exceeds limit ${maxAssetCount}`,
      );
    }
    const len = cur.readU32LE(`asset[${assets.length}].length`);
    if (len > maxAsset) {
      throw new TranslationError(
        "risum/asset_too_large",
        `asset[${assets.length}] is ${len} bytes, exceeds limit ${maxAsset}`,
      );
    }
    const encoded = cur.readSlice(len, `asset[${assets.length}].data`);
    assets.push(decodeRPack(encoded));
  }

  return { version, module, assets, payloadText };
}

export interface EncodeInput {
  readonly payloadText?: string;
  readonly module?: unknown;
  readonly assets?: readonly Uint8Array[];
}

export function encodeRisum(input: EncodeInput, opts: { jsonIndent?: number | null } = {}): Uint8Array {
  let jsonText: string;
  if (input.payloadText !== undefined) {
    jsonText = input.payloadText;
  } else if (input.module !== undefined) {
    const indent = opts.jsonIndent === undefined ? 2 : opts.jsonIndent;
    jsonText = indent === null
      ? JSON.stringify({ module: input.module, type: "risuModule" })
      : JSON.stringify({ module: input.module, type: "risuModule" }, null, indent);
  } else {
    throw new TranslationError("risum/encode_no_input", "encodeRisum requires either payloadText or module");
  }
  const jsonBytes = new TextEncoder().encode(jsonText);
  const encodedPayload = encodeRPack(jsonBytes);
  const assets = input.assets ?? [];

  let total = 2 + 4 + encodedPayload.length + 1;
  for (const a of assets) total += 1 + 4 + a.length;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = RISUM_MAGIC;
  out[o++] = RISUM_VERSION;
  view.setUint32(o, encodedPayload.length, true); o += 4;
  out.set(encodedPayload, o); o += encodedPayload.length;
  for (const a of assets) {
    out[o++] = RISUM_MARK_ASSET;
    view.setUint32(o, a.length, true); o += 4;
    out.set(encodeRPack(a), o); o += a.length;
  }
  out[o++] = RISUM_MARK_END;
  return out;
}
