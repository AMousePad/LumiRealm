import { extractPngTextChunks } from '../realm/import-formats/png-chunks.js';

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

export function buildXMeta(bytes: Uint8Array): string {
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
