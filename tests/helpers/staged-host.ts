import { zipSync, unzipSync, type Zippable } from 'fflate';
import type { SpindleAPI, SpindleFileRef, SpindleFileSource } from 'lumiverse-spindle-types';
import { stageBytes } from '../../src/host-services/files.js';

export function stagedHost() {
  const data = new Map<string, Uint8Array>();
  const refs = new Map<string, SpindleFileRef>();
  const reads: string[] = [];
  const images = new Map<string, Uint8Array>();
  const host = {
    files: {
      async create(input) {
        const file = { fileId: crypto.randomUUID(), fileName: input.fileName, size: input.size ?? 0, mimeType: input.mimeType ?? '' };
        refs.set(file.fileId, file);
        data.set(file.fileId, new Uint8Array(file.size));
        return file;
      },
      async writeChunk(id, offset, bytes) { data.get(id)!.set(bytes, offset); return offset + bytes.length; },
      async finish(id) { return refs.get(id)!; },
      async readChunk(source, offset) {
        const id = 'fileId' in source ? source.fileId : source.uploadId;
        reads.push(id);
        const bytes = data.get(id);
        if (!bytes) throw new Error('Missing file');
        const chunk = bytes.slice(offset, offset + 1024 * 1024);
        return { data: chunk, size: bytes.length, offset, eof: offset + chunk.length === bytes.length };
      },
      async delete(id) { refs.delete(id); return data.delete(id); },
    },
    archives: {
      async extract(source: SpindleFileSource) {
        const id = 'fileId' in source ? source.fileId : source.uploadId;
        return Promise.all(Object.entries(unzipSync(data.get(id)!)).map(async ([name, bytes]) => ({ name, file: await stageBytes(host.files, bytes, name, 'user') })));
      },
      async create(entries, options) {
        const files: Zippable = {};
        for (const entry of entries) {
          const id = 'fileId' in entry.source ? entry.source.fileId : entry.source.uploadId;
          files[entry.name] = [data.get(id)!, { level: entry.store ? 0 : 6 }];
        }
        return stageBytes(host.files, zipSync(files), options?.fileName ?? 'export.zip', 'user');
      },
    },
    images: { async readBinary(id) { const bytes = images.get(id); if (!bytes) throw new Error('Missing image'); return bytes; } },
  } as Pick<SpindleAPI, 'files' | 'archives' | 'images'>;
  return { host, data, refs, reads, images };
}
