import type { SpindleAPI, SpindleFileSource } from 'lumiverse-spindle-types';
import { readCharx, readCharxEntries, isZipArchive, findJpegZipBoundary, type CharxBundle } from './reader.js';
import { convertToCharx } from '../../realm/import-formats/index.js';
import { readStagedBytes } from '../../host-services/files.js';
import { TranslationError } from '../errors.js';

export interface DeferredAsset {
  readonly byteLength: number;
  read(): Promise<Uint8Array>;
}
export interface PreparedCard {
  readonly bundle: CharxBundle;
  readonly assets: ReadonlyMap<string, DeferredAsset>;
}
const MAX_ENTRY = 64 * 1024 * 1024;

export async function withStagedCard<T>(
  host: Pick<SpindleAPI, 'files' | 'archives'>, source: SpindleFileSource,
  fileName: string, userId: string, consume: (card: PreparedCard) => Promise<T>,
): Promise<T> {
  const cleanup: string[] = [];
  try {
    let first = await host.files.readChunk(source, 0, userId);
    let archive = source;
    let isPolyglot = false;
    if (first.data[0] === 0xff && first.data[1] === 0xd8) {
      const prefix = new Uint8Array(Math.min(first.size, 10 * 1024 * 1024 + 6));
      let offset = 0;
      while (offset < prefix.length) {
        const part = first.data.subarray(0, prefix.length - offset);
        if (!part.length) throw new TranslationError('charx/bad_zip', 'Incomplete JPEG preview');
        prefix.set(part, offset);
        offset += part.length;
        if (offset < prefix.length) first = await host.files.readChunk(source, offset, userId);
      }
      const boundary = findJpegZipBoundary(prefix);
      if (boundary < 0) throw new TranslationError('charx/not_zip', 'JPEG does not contain a ZIP archive');
      const zip = await host.files.create({ fileName: 'card.zip', size: first.size - boundary, userId });
      cleanup.push(zip.fileId);
      let written = 0;
      for (let offset = boundary; offset < first.size;) {
        const chunk = await host.files.readChunk(source, offset, userId);
        if (!chunk.data.length) throw new TranslationError('charx/bad_zip', 'Incomplete ZIP archive');
        written = await host.files.writeChunk(zip.fileId, written, chunk.data, userId);
        offset += chunk.data.length;
      }
      await host.files.finish(zip.fileId, userId);
      archive = { fileId: zip.fileId };
      isPolyglot = true;
    } else if (!isZipArchive(first.data)) {
      const bytes = await readStagedBytes(host.files, source, userId, 2 * 1024 ** 3);
      const converted = convertToCharx(bytes, fileName);
      return await consume({ bundle: readCharx(converted.bytes), assets: new Map() });
    }
    const entries = await host.archives.extract(archive, { userId, maxDecompressedBytes: 20 * 1024 ** 3 });
    cleanup.push(...entries.map(entry => entry.file.fileId));
    const metadata = new Map<string, Uint8Array>();
    const assets = new Map<string, DeferredAsset>();
    const oversized: { name: string; uncompressedSize: number }[] = [];
    let metadataBytes = 0;
    for (const { name, file } of entries) {
      if (file.size > MAX_ENTRY) { oversized.push({ name, uncompressedSize: file.size }); continue; }
      const read = () => readStagedBytes(host.files, { fileId: file.fileId }, userId, MAX_ENTRY);
      if (name.endsWith('.json') || name === 'module.risum') {
        metadataBytes += file.size;
        if (metadataBytes > 2 * 1024 ** 3) throw new TranslationError('charx/total_size_exceeded', 'Card metadata exceeds 2 GiB');
        metadata.set(name, await read());
      } else assets.set(name, { byteLength: file.size, read });
    }
    const bundle = readCharxEntries(metadata, { zipOversized: oversized, isPolyglot });
    return await consume({ bundle, assets });
  } finally {
    const errors: unknown[] = [];
    for (const id of cleanup) {
      try { await host.files.delete(id, userId); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Could not clean up imported files');
  }
}
