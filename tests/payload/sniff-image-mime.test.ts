import { describe, it, expect } from 'bun:test';
import { sniffImageMime } from '../../src/payload/import.js';

const padTo = (head: readonly number[], n = 16): Uint8Array => {
  const out = new Uint8Array(n);
  for (let i = 0; i < head.length; i++) out[i] = head[i]!;
  return out;
};

describe('sniffImageMime', () => {
  it('detects PNG magic', () => {
    const r = sniffImageMime(padTo([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(r).toEqual({ ext: 'png', mime: 'image/png' });
  });

  it('detects JPEG magic', () => {
    expect(sniffImageMime(padTo([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(sniffImageMime(padTo([0xff, 0xd8, 0xff, 0xe1]))).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(sniffImageMime(padTo([0xff, 0xd8, 0xff, 0xdb]))).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
  });

  it('detects GIF87a + GIF89a magic', () => {
    expect(sniffImageMime(padTo([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toEqual({ ext: 'gif', mime: 'image/gif' });
    expect(sniffImageMime(padTo([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toEqual({ ext: 'gif', mime: 'image/gif' });
  });

  it('detects WEBP magic', () => {
    const r = sniffImageMime(padTo([
      0x52, 0x49, 0x46, 0x46, 0xd6, 0x10, 0x01, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]));
    expect(r).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  it('does NOT confuse RIFF/WAV with WEBP', () => {
    const r = sniffImageMime(padTo([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45,
    ]));
    expect(r).toEqual({ ext: 'wav', mime: 'audio/wav' });
  });

  it('detects MP3 (ID3 tag and frame sync)', () => {
    expect(sniffImageMime(padTo([0x49, 0x44, 0x33, 0x04]))).toEqual({ ext: 'mp3', mime: 'audio/mpeg' });
    expect(sniffImageMime(padTo([0xff, 0xfb]))).toEqual({ ext: 'mp3', mime: 'audio/mpeg' });
  });

  it('detects OGG, MP4, WEBM', () => {
    expect(sniffImageMime(padTo([0x4f, 0x67, 0x67, 0x53]))).toEqual({ ext: 'ogg', mime: 'audio/ogg' });
    expect(sniffImageMime(padTo([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toEqual({ ext: 'mp4', mime: 'video/mp4' });
    expect(sniffImageMime(padTo([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ ext: 'webm', mime: 'video/webm' });
  });

  it('returns null for too-short input', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it('returns null for unknown magic', () => {
    expect(sniffImageMime(padTo([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });
});
