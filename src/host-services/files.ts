import type { SpindleFilesAPI, SpindleFileSource } from 'lumiverse-spindle-types';
import { HostServiceError } from './protocol.js';

export async function stageBytes(files: SpindleFilesAPI, bytes: Uint8Array, name: string, userId: string) {
  const file = await files.create({ fileName: name, size: bytes.length, userId });
  try {
    for (let offset = 0; offset < bytes.length;) {
      const chunk = bytes.subarray(offset, offset + 1024 * 1024);
      const next = await files.writeChunk(file.fileId, offset, chunk, userId);
      if (next !== offset + chunk.length) throw new HostServiceError('Invalid host upload offset');
      offset = next;
    }
    return await files.finish(file.fileId, userId);
  } catch (error) {
    await files.delete(file.fileId, userId);
    throw error;
  }
}

export async function readStagedBytes(files: SpindleFilesAPI, source: SpindleFileSource, userId: string, maxBytes: number): Promise<Uint8Array> {
  let offset = 0;
  let bytes: Uint8Array | undefined;
  for (;;) {
    const chunk = await files.readChunk(source, offset, userId);
    if (!Number.isSafeInteger(chunk.size) || chunk.size < 0 || chunk.size > maxBytes) throw new HostServiceError(`File exceeds the ${maxBytes} byte read limit`);
    bytes ??= new Uint8Array(chunk.size);
    if (chunk.size !== bytes.length || chunk.offset !== offset || offset + chunk.data.length > bytes.length) throw new HostServiceError('Invalid host file chunk');
    bytes.set(chunk.data, offset);
    offset += chunk.data.length;
    if (chunk.eof) {
      if (offset !== bytes.length) throw new HostServiceError('Incomplete host file');
      return bytes;
    }
    if (!chunk.data.length) throw new HostServiceError('Host file read made no progress');
  }
}
