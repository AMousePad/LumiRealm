import { describe, test, expect } from 'bun:test';
import { parseBgmCtrl } from '../../src/audio/bgm.js';

// ─── Phase 8 — bgm marker parser tests ───────────────────────────────
//
// The DOM-walking observer in `setupBgmPlayer` needs a browser env to
// test (Audio, MutationObserver, document). The load-bearing parser is
// pure — pin it here so a corner-case marker format doesn't silently
// stop matching a card.
//
// Risu source: observer.svelte.ts:57-63
//   const split = ctrlName.split('___');
//   if (split[0] === 'bgm') {
//     const volume = split[1] === 'auto' ? 0.5 : parseFloat(split[1]);
//     ...
//     bgmElement = new Audio(split[2]);
//   }

describe('parseBgmCtrl — Phase 8 BGM marker parser', () => {
  test('volume=auto → 0.5', () => {
    expect(parseBgmCtrl('bgm___auto___https://x.example/song.mp3'))
      .toEqual({ volume: 0.5, url: 'https://x.example/song.mp3' });
  });

  test('volume=numeric string → parsed', () => {
    expect(parseBgmCtrl('bgm___0.7___/api/v1/images/abc123'))
      .toEqual({ volume: 0.7, url: '/api/v1/images/abc123' });
  });

  test('clamps volume to [0, 1]', () => {
    expect(parseBgmCtrl('bgm___1.5___/u')!.volume).toBe(1);
    expect(parseBgmCtrl('bgm___-0.5___/u')!.volume).toBe(0);
  });

  test('non-numeric volume → 0.5 fallback', () => {
    expect(parseBgmCtrl('bgm___abc___/u')!.volume).toBe(0.5);
    expect(parseBgmCtrl('bgm___NaN___/u')!.volume).toBe(0.5);
  });

  test('returns null for non-bgm prefix', () => {
    expect(parseBgmCtrl('emo___auto___/u')).toBeNull();
    expect(parseBgmCtrl('other')).toBeNull();
    expect(parseBgmCtrl('')).toBeNull();
  });

  test('returns null when split has fewer than 3 parts', () => {
    expect(parseBgmCtrl('bgm___auto')).toBeNull();
    expect(parseBgmCtrl('bgm___')).toBeNull();
  });

  test('returns null when url is empty', () => {
    expect(parseBgmCtrl('bgm___0.5___')).toBeNull();
  });

  test('preserves URLs with special characters', () => {
    const parsed = parseBgmCtrl('bgm___0.5___https://cdn.example.com/path?token=abc&x=y');
    expect(parsed?.url).toBe('https://cdn.example.com/path?token=abc&x=y');
  });

  test('does NOT split on extra "___" past the third (URL preserves)', () => {
    // If a URL itself contains "___" (rare), Risu's `split('___')` and
    // `split[2]` would truncate. Our impl matches Risu's behaviour
    // verbatim — preserve the parity quirk.
    const parsed = parseBgmCtrl('bgm___auto___http://x___y');
    expect(parsed?.url).toBe('http://x'); // Risu byte-for-byte
  });
});
