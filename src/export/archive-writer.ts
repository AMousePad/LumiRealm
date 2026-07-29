// Browser half of the export path. The worker plans entries; only the browser
// holds the session cookie needed to read image bytes back out of Lumiverse.
//
// Entry order, deflate levels and the x_meta companions mirror Risu's
// CharXWriter so the output stays importable by RisuAI.

import { Zip, ZipDeflate } from 'fflate';
import type { ArchivePlan, PlannedEntry } from '../core/export/archive-types.js';
import { latin1ToBytes } from '../core/export/module-archive.js';
import { extractPngTextChunks } from '../realm/import-formats/png-chunks.js';

export interface ArchiveWriterLog {
  readonly info: (m: string) => void;
  readonly warn: (m: string) => void;
}

export interface BuildArchiveResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly skippedAssets: readonly string[];
}

const PINNED_MTIME = new Date(2000, 0, 1);

type ImageType = 'JPEG' | 'PNG' | 'GIF' | 'BMP' | 'AVIF' | 'WEBP' | 'Unknown';

/** Port of Risu's getImageType. Drives the x_meta `type` field. */
export function getImageType(a: Uint8Array): ImageType {
  if (a.length < 12) return 'Unknown';
  if (a[0] === 0xff && a[1] === 0xd8 && a[a.length - 2] === 0xff && a[a.length - 1] === 0xd9) return 'JPEG';
  if (a[0] === 0x89 && a[1] === 0x50 && a[2] === 0x4e && a[3] === 0x47 &&
      a[4] === 0x0d && a[5] === 0x0a && a[6] === 0x1a && a[7] === 0x0a) return 'PNG';
  if (a[0] === 0x47 && a[1] === 0x49 && a[2] === 0x46 && a[3] === 0x38 &&
      (a[4] === 0x37 || a[4] === 0x39) && a[5] === 0x61) return 'GIF';
  if (a[0] === 0x42 && a[1] === 0x4d) return 'BMP';
  if (a[4] === 0x66 && a[5] === 0x74 && a[6] === 0x79 && a[7] === 0x70 &&
      a[8] === 0x61 && a[9] === 0x76 && a[10] === 0x69 && a[11] === 0x66) return 'AVIF';
  if (a[0] === 0x52 && a[1] === 0x49 && a[2] === 0x46 && a[3] === 0x46 &&
      a[8] === 0x57 && a[9] === 0x45 && a[10] === 0x42 && a[11] === 0x50) return 'WEBP';
  return 'Unknown';
}

async function fetchImageBytes(imageId: string): Promise<Uint8Array> {
  const resp = await fetch(`/api/v1/images/${encodeURIComponent(imageId)}`, {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

function buildXMeta(bytes: Uint8Array): string {
  const type = getImageType(bytes);
  if (type === 'PNG') {
    let chunks: Record<string, string> = {};
    try {
      chunks = Object.fromEntries(extractPngTextChunks(bytes).map((c) => [c.key, c.text]));
    } catch {
      chunks = {};
    }
    if (Object.keys(chunks).length > 0) return JSON.stringify(chunks, null, 4);
  }
  return JSON.stringify({ type });
}

/** Sequential sink over fflate's streaming Zip. Each entry is pushed to
 *  completion before the next is added, matching CharXWriter's write loop. */
class SequentialZip {
  readonly #zip: Zip;
  readonly #chunks: Uint8Array[] = [];
  #ended = false;
  #error: Error | null = null;

  constructor() {
    this.#zip = new Zip((err, data, final) => {
      if (err) this.#error = err;
      if (data) this.#chunks.push(data);
      if (final) this.#ended = true;
    });
  }

  add(path: string, data: Uint8Array, level: 0 | 6): void {
    if (this.#error) throw this.#error;
    const file = new ZipDeflate(path, { level });
    // Pinned so two exports of unchanged data produce identical bytes. fflate
    // defaults to Date.now(), which Risu inherits. Must land in 1980..2099 in
    // local time or fflate rejects the DOS date field.
    file.mtime = PINNED_MTIME;
    this.#zip.add(file);
    file.push(data, true);
    if (this.#error) throw this.#error;
  }

  finish(): Blob {
    this.#zip.end();
    if (this.#error) throw this.#error;
    if (!this.#ended) throw new Error('zip stream did not finalize');
    const parts = this.#chunks.map((c) => c.slice().buffer as ArrayBuffer);
    return new Blob(parts, { type: 'application/zip' });
  }
}

export async function buildArchive(
  plan: ArchivePlan,
  log: ArchiveWriterLog,
  onProgress?: (done: number, total: number) => void,
): Promise<BuildArchiveResult> {
  const zip = new SequentialZip();
  const encoder = new TextEncoder();
  const skippedAssets: string[] = [];
  const total = plan.entries.length;
  let done = 0;

  for (const entry of plan.entries as readonly PlannedEntry[]) {
    if (entry.kind === 'text') {
      zip.add(entry.path, encoder.encode(entry.text), entry.level);
    } else if (entry.kind === 'binary') {
      zip.add(entry.path, latin1ToBytes(entry.latin1), entry.level);
    } else {
      let bytes: Uint8Array;
      try {
        bytes = await fetchImageBytes(entry.imageId);
      } catch (err) {
        // A missing asset must not silently produce a broken card.
        skippedAssets.push(entry.path);
        log.warn(
          `export: asset fetch failed path=${entry.path} image=${entry.imageId}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        done += 1;
        onProgress?.(done, total);
        continue;
      }
      zip.add(entry.metaPath, encoder.encode(buildXMeta(bytes)), 6);
      zip.add(entry.path, bytes, entry.level);
    }
    done += 1;
    onProgress?.(done, total);
  }

  return { blob: zip.finish(), fileName: plan.fileName, skippedAssets };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
