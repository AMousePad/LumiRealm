import { TranslationError } from '../errors.js';
import { decodeRPackInto } from '../rpack/rpack.js';
import {
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_ASSET_COUNT,
  DEFAULT_MAX_PAYLOAD_BYTES,
  RISUM_MAGIC,
  RISUM_MARK_ASSET,
  RISUM_MARK_END,
  RISUM_VERSION,
} from './codec.js';

export interface UploadChunk {
  readonly fileName: string;
  readonly size: number;
  readonly offset: number;
  readonly data: Uint8Array;
  readonly eof: boolean;
}

export interface RisumUploadSource {
  readonly size: number;
  readonly module: unknown;
  readonly assetCount: number;
  readAsset(index: number): Promise<Uint8Array | undefined>;
  finish(): Promise<number>;
}

type ReadChunk = (offset: number) => Promise<UploadChunk | null>;

class UploadCursor {
  private position = 0;
  private cached: UploadChunk;

  private constructor(
    private readonly readChunk: ReadChunk,
    first: UploadChunk,
  ) {
    this.cached = first;
  }

  static async open(readChunk: ReadChunk): Promise<UploadCursor> {
    const first = await readChunk(0);
    if (!first) throw new Error('upload not found or expired');
    if (
      first.offset !== 0 ||
      !Number.isSafeInteger(first.size) ||
      first.size < 0 ||
      first.data.length > first.size ||
      (first.size > 0 && first.data.length === 0)
    ) {
      throw new Error('upload returned invalid metadata');
    }
    return new UploadCursor(readChunk, first);
  }

  get size(): number { return this.cached.size; }
  get pos(): number { return this.position; }

  async readU8(label: string): Promise<number> {
    const out = new Uint8Array(1);
    await this.copyInto(out, 0, 1, false, label);
    return out[0]!;
  }

  async readU32LE(label: string): Promise<number> {
    const out = new Uint8Array(4);
    await this.copyInto(out, 0, 4, false, label);
    return (out[0]! | (out[1]! << 8) | (out[2]! << 16) | (out[3]! << 24)) >>> 0;
  }

  async readRPack(length: number, label: string): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    await this.copyInto(out, 0, length, true, label);
    return out;
  }

  async skip(length: number, label: string): Promise<void> {
    this.requireAvailable(length, label);
    this.position += length;
  }

  private async copyInto(
    out: Uint8Array,
    outOffset: number,
    length: number,
    decode: boolean,
    label: string,
  ): Promise<void> {
    this.requireAvailable(length, label);
    let remaining = length;
    while (remaining > 0) {
      await this.ensureChunk();
      const inOffset = this.position - this.cached.offset;
      const take = Math.min(remaining, this.cached.data.length - inOffset);
      const source = this.cached.data.subarray(inOffset, inOffset + take);
      if (decode) decodeRPackInto(source, out, outOffset);
      else out.set(source, outOffset);
      this.position += take;
      outOffset += take;
      remaining -= take;
    }
  }

  private requireAvailable(length: number, label: string): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.size) {
      throw new TranslationError(
        'risum/truncated',
        `${label}: need ${length} bytes at offset ${this.position}, only ${this.size - this.position} remain`,
      );
    }
  }

  private async ensureChunk(): Promise<void> {
    const end = this.cached.offset + this.cached.data.length;
    if (this.position >= this.cached.offset && this.position < end) return;
    const next = await this.readChunk(this.position);
    if (!next) throw new Error('upload not found or expired');
    if (
      next.offset !== this.position ||
      next.size !== this.size ||
      next.data.length === 0 ||
      next.offset + next.data.length > next.size
    ) {
      throw new Error(`upload returned invalid chunk at offset ${this.position}`);
    }
    this.cached = next;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function openRisumUpload(readChunk: ReadChunk): Promise<RisumUploadSource> {
  const cursor = await UploadCursor.open(readChunk);
  const magic = await cursor.readU8('magic');
  if (magic !== RISUM_MAGIC) {
    throw new TranslationError('risum/bad_magic', `expected magic 0x${RISUM_MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
  }
  const version = await cursor.readU8('version');
  if (version !== RISUM_VERSION) {
    throw new TranslationError('risum/unsupported_version', `unsupported risum version ${version}`);
  }
  const payloadLength = await cursor.readU32LE('payload_length');
  if (payloadLength > DEFAULT_MAX_PAYLOAD_BYTES) {
    throw new TranslationError('risum/payload_too_large', `payload is ${payloadLength} bytes, exceeds limit ${DEFAULT_MAX_PAYLOAD_BYTES}`);
  }
  const payloadBytes = await cursor.readRPack(payloadLength, 'payload');
  let payloadText: string;
  try {
    payloadText = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch (cause) {
    throw new TranslationError('risum/invalid_utf8', 'RPack-decoded payload is not valid UTF-8', { cause });
  }
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(payloadText);
  } catch (cause) {
    throw new TranslationError('risum/invalid_json', 'RPack-decoded payload is not valid JSON', { cause });
  }
  if (!isPlainObject(wrapper) || wrapper.type !== 'risuModule' || !isPlainObject(wrapper.module)) {
    throw new TranslationError('risum/bad_wrapper', 'payload is not a risuModule wrapper');
  }

  const module = wrapper.module;
  const manifest = Array.isArray(module.assets) ? module.assets : [];
  let nextAssetIndex = 0;
  let ended = false;

  const readHeader = async (): Promise<number | null> => {
    if (cursor.pos === cursor.size) {
      ended = true;
      return null;
    }
    const mark = await cursor.readU8(`asset[${nextAssetIndex}].mark`);
    if (mark === RISUM_MARK_END) {
      ended = true;
      if (cursor.pos !== cursor.size) {
        throw new TranslationError('risum/trailing_bytes', `${cursor.size - cursor.pos} unexpected bytes after end-of-file marker`);
      }
      return null;
    }
    if (mark !== RISUM_MARK_ASSET) {
      throw new TranslationError('risum/bad_mark', `asset[${nextAssetIndex}]: expected mark 0x00 or 0x01, got 0x${mark.toString(16)}`);
    }
    if (nextAssetIndex >= DEFAULT_MAX_ASSET_COUNT) {
      throw new TranslationError('risum/too_many_assets', `asset count exceeds limit ${DEFAULT_MAX_ASSET_COUNT}`);
    }
    const length = await cursor.readU32LE(`asset[${nextAssetIndex}].length`);
    if (length > DEFAULT_MAX_ASSET_BYTES) {
      throw new TranslationError('risum/asset_too_large', `asset[${nextAssetIndex}] is ${length} bytes, exceeds limit ${DEFAULT_MAX_ASSET_BYTES}`);
    }
    return length;
  };

  return {
    size: cursor.size,
    module,
    assetCount: manifest.length,
    async readAsset(index) {
      if (!Number.isInteger(index) || index < nextAssetIndex) {
        throw new Error(`risum assets must be read in order (requested ${index}, next ${nextAssetIndex})`);
      }
      while (!ended && nextAssetIndex <= index) {
        const length = await readHeader();
        if (length === null) return undefined;
        const current = nextAssetIndex++;
        if (current === index) return cursor.readRPack(length, `asset[${current}].data`);
        await cursor.skip(length, `asset[${current}].data`);
      }
      return undefined;
    },
    async finish() {
      while (!ended) {
        const length = await readHeader();
        if (length === null) break;
        const current = nextAssetIndex++;
        await cursor.skip(length, `asset[${current}].data`);
      }
      return nextAssetIndex;
    },
  };
}
