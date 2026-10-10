import * as fflate from 'fflate';
import { decode } from '@msgpack/msgpack';
import { decodeRPack } from '../rpack/rpack.js';
import { TranslationError } from '../errors.js';

export interface RisuPresetRaw {
  readonly name?: string;
  readonly presetVersion?: number;
  readonly promptTemplate?: readonly Record<string, unknown>[];
  readonly customPromptTemplateToggle?: string;
  readonly temperature?: number;
  readonly maxResponse?: number;
  readonly maxContext?: number;
  readonly frequencyPenalty?: number;
  readonly PresensePenalty?: number;
  readonly repetition_penalty?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly min_p?: number;
  readonly aiModel?: string;
  readonly subModel?: string;
  readonly regex?: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

async function decryptBuffer(data: Uint8Array, keyStr: string): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TranslationError('risup/crypto_unavailable', 'Web Crypto subtle is required for .risup decryption');
  }
  const keyArray = await subtle.digest('SHA-256', new TextEncoder().encode(keyStr));
  const key = await subtle.importKey('raw', keyArray, 'AES-GCM', false, ['decrypt']);
  return await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data as unknown as BufferSource);
}

export function isRisuPresetBytes(bytes: Uint8Array, fileName = ''): boolean {
  if (fileName.endsWith('.risup') || fileName.endsWith('.risupreset')) {
    return true;
  }
  if (bytes.length > 0 && bytes[0] === 0x7b /* '{' */) {
    try {
      const text = new TextDecoder().decode(bytes.subarray(0, 1024));
      return text.includes('"promptTemplate"') || text.includes('"customPromptTemplateToggle"');
    } catch {
      return false;
    }
  }
  return false;
}

export async function decodeRisuPreset(bytes: Uint8Array, fileName = ''): Promise<RisuPresetRaw> {
  // 1. Plain JSON
  if (bytes.length > 0 && bytes[0] === 0x7b /* '{' */) {
    try {
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && (parsed.promptTemplate || parsed.name)) {
        return parsed as RisuPresetRaw;
      }
    } catch {
      // Fall through to binary decode
    }
  }

  // 2. Binary .risup (RPack-encoded + compressed) or .risupreset (compressed)
  let decompressed: Uint8Array;
  try {
    const rpacked = decodeRPack(bytes);
    decompressed = fflate.decompressSync(rpacked);
  } catch {
    try {
      decompressed = fflate.decompressSync(bytes);
    } catch (decompErr) {
      throw new TranslationError(
        'risup/decompress_failed',
        `Failed to decompress preset buffer: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}`,
      );
    }
  }

  let container: unknown;
  try {
    container = decode(decompressed);
  } catch (msgErr) {
    throw new TranslationError(
      'risup/msgpack_failed',
      `Failed to unpack msgpack container: ${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
    );
  }

  if (!container || typeof container !== 'object') {
    throw new TranslationError('risup/invalid_container', 'Decoded preset container is not an object');
  }

  const rec = container as Record<string, unknown>;

  // Risu encrypted preset container: { presetVersion: 2, type: 'preset', preset: <bytes> }
  if (rec.type === 'preset' && (rec.preset || rec.pres)) {
    const encBytes = (rec.preset ?? rec.pres) as Uint8Array;
    let decrypted: ArrayBuffer;
    try {
      decrypted = await decryptBuffer(encBytes, 'risupreset');
    } catch (decErr) {
      throw new TranslationError(
        'risup/decrypt_failed',
        `Failed to decrypt preset payload: ${decErr instanceof Error ? decErr.message : String(decErr)}`,
      );
    }
    try {
      return decode(new Uint8Array(decrypted)) as RisuPresetRaw;
    } catch (innerErr) {
      throw new TranslationError(
        'risup/inner_msgpack_failed',
        `Failed to unpack decrypted preset payload: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
      );
    }
  }

  // Unencrypted preset object inside container
  if (rec.promptTemplate || rec.name) {
    return rec as RisuPresetRaw;
  }

  throw new TranslationError('risup/unknown_format', 'Could not extract valid preset payload');
}
