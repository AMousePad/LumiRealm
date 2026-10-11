import type { SpindleAPI, SpindleArchiveEntry } from 'lumiverse-spindle-types';
import type { ArchivePlan } from '../core/export/archive-types.js';
import { latin1ToBytes } from '../core/export/module-archive.js';
import { stageBytes } from '../host-services/files.js';
import { buildXMeta } from './archive-writer.js';

export async function buildStagedArchive(host: Pick<SpindleAPI, 'files' | 'archives' | 'images'>, plan: ArchivePlan, userId: string) {
  const cleanup: string[] = [];
  const entries: SpindleArchiveEntry[] = [];
  const skippedAssets: string[] = [];
  const encoder = new TextEncoder();
  let size = 0;
  async function add(name: string, bytes: Uint8Array, store: boolean) {
    const file = await stageBytes(host.files, bytes, 'export-entry', userId);
    cleanup.push(file.fileId);
    entries.push({ name, source: { fileId: file.fileId }, store });
    size += bytes.length;
  }
  try {
    for (const entry of plan.entries) {
      if (entry.kind === 'text') await add(entry.path, encoder.encode(entry.text), entry.level === 0);
      else if (entry.kind === 'binary') await add(entry.path, latin1ToBytes(entry.latin1), entry.level === 0);
      else {
        let bytes: Uint8Array;
        try { bytes = await host.images.readBinary(entry.imageId, userId); }
        catch { skippedAssets.push(entry.path); continue; }
        await add(entry.metaPath, encoder.encode(buildXMeta(bytes)), false);
        await add(entry.path, bytes, entry.level === 0);
      }
    }
    const file = await host.archives.create(entries, {
      fileName: plan.fileName, userId,
      maxBytes: Math.ceil(size * 1.01) + entries.length * 1024 + 1024 * 1024,
    });
    return { fileId: file.fileId, fileName: plan.fileName, skippedAssets };
  } finally {
    const errors: unknown[] = [];
    for (const id of cleanup) {
      try { await host.files.delete(id, userId); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Could not clean up export files');
  }
}
