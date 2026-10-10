import { describe, expect, test } from 'bun:test';
import { applyIframePolicy } from '../../src/core/mappers/iframe-policy.js';

// Mirrors Lumi's `extractTrustedYouTubeEmbed` validator at
// frontend/src/components/chat/MessageContent.tsx:993-1019. Output must be a
// pure-iframe markup pointing at youtube-nocookie.com so the React component
// detects + sandboxes it.

describe('applyIframePolicy', () => {
  test('passthrough when no iframe', () => {
    const { html, youtubeReplaced, stripped } = applyIframePolicy('<p>hello world</p>');
    expect(html).toBe('<p>hello world</p>');
    expect(youtubeReplaced).toBe(0);
    expect(stripped).toBe(0);
  });

  test('youtube.com embed → rewritten to youtube-nocookie.com canonical iframe', () => {
    const input = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.stripped).toBe(0);
    expect(r.html).toBe('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="YouTube video"></iframe>');
  });

  test('youtube-nocookie.com embed accepted as-is (canonical form)', () => {
    const input = '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.stripped).toBe(0);
    expect(r.html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  test('YouTube embed without www on youtube.com', () => {
    const input = '<iframe src="https://youtube.com/embed/abc123XYZ_-"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).toContain('https://www.youtube-nocookie.com/embed/abc123XYZ_-');
  });

  test('allowed query params (autoplay/controls) preserved', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123?autoplay=1&controls=0"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).toContain('embed/abc123?autoplay=1&controls=0');
  });

  test('start/end numeric params preserved within \\d{1,6} bounds', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123?start=42&end=99999"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).toContain('start=42');
    expect(r.html).toContain('end=99999');
  });

  test('si token param preserved within charset', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123?si=AbCdEfGh-_12"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).toContain('si=AbCdEfGh-_12');
  });

  test('boolean param with non-0/1 value dropped', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123?autoplay=true"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).not.toContain('autoplay');
    expect(r.html).toContain('embed/abc123');
  });

  test('unknown query param dropped, iframe still emitted', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123?unknown=x&autoplay=1"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).not.toContain('unknown');
    expect(r.html).toContain('autoplay=1');
  });

  test('iframe with hash fragment rejected', () => {
    const input = '<iframe src="https://www.youtube.com/embed/abc123#t=42"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.stripped).toBe(1);
    expect(r.youtubeReplaced).toBe(0);
    expect(r.html).toBe('');
  });

  test('non-YouTube iframe stripped', () => {
    const input = '<iframe src="https://evil.example.com/track"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.stripped).toBe(1);
    expect(r.youtubeReplaced).toBe(0);
    expect(r.html).toBe('');
  });

  test('mixed: YouTube + other = rewrite + strip', () => {
    const input =
      'before<iframe src="https://example.com/x"></iframe>' +
      '<iframe src="https://www.youtube.com/embed/Z9p0K_3kEwM"></iframe>after';
    const r = applyIframePolicy(input);
    expect(r.stripped).toBe(1);
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html.startsWith('before')).toBe(true);
    expect(r.html.endsWith('after')).toBe(true);
    expect(r.html).toContain('Z9p0K_3kEwM');
    expect(r.html).not.toContain('example.com/x');
  });

  test('iframe with no src stripped', () => {
    const r = applyIframePolicy('<iframe sandbox="allow-scripts" srcdoc="..."></iframe>');
    expect(r.stripped).toBe(1);
    expect(r.html).toBe('');
  });

  test('self-closing iframe (no closing tag)', () => {
    const r = applyIframePolicy('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" />');
    expect(r.youtubeReplaced).toBe(1);
    expect(r.html).toContain('dQw4w9WgXcQ');
  });

  test('id shorter than 6 chars is rejected (Lumi validator floor)', () => {
    const r = applyIframePolicy('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
    expect(r.stripped).toBe(1);
    expect(r.youtubeReplaced).toBe(0);
  });

  test('javascript: src stripped', () => {
    const r = applyIframePolicy('<iframe src="javascript:alert(1)"></iframe>');
    expect(r.stripped).toBe(1);
    expect(r.html).toBe('');
  });

  test('idempotent on plain HTML', () => {
    const input = '<p>plain</p>';
    const once = applyIframePolicy(input).html;
    const twice = applyIframePolicy(once).html;
    expect(twice).toBe(once);
  });

  test('idempotent on already-rewritten iframe', () => {
    const input = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
    const once = applyIframePolicy(input).html;
    const twice = applyIframePolicy(once).html;
    expect(twice).toBe(once);
  });

  test('output for emitted YouTube iframe is the sole element of its container', () => {
    // Lumi's `extractTrustedYouTubeEmbed` parses each matched iframe with
    // DOMParser and rejects the embed unless the body has exactly one child
    // (the iframe) and no surrounding text. Our emitted markup MUST
    // round-trip cleanly through that validator.
    const input = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
    const r = applyIframePolicy(input);
    expect(r.html.startsWith('<iframe')).toBe(true);
    expect(r.html.endsWith('</iframe>')).toBe(true);
    // Exactly one iframe (no nested / sibling elements).
    expect(r.html.match(/<iframe\b/g)?.length).toBe(1);
    expect(r.html.match(/<\/iframe>/g)?.length).toBe(1);
    // No text / element content between open and close tags.
    const inner = r.html.replace(/^<iframe\b[^>]*>/, '').replace(/<\/iframe>$/, '');
    expect(inner).toBe('');
  });

  test('attribute-injection attempt cannot smuggle iframe', () => {
    const r = applyIframePolicy('<iframe src=\'https://www.youtube.com/embed/abc"><iframe src="evil\'></iframe>');
    // The src value contains a `"` which terminates the [A-Za-z0-9_-]
    // charset before the regex's required boundary, so the iframe doesn't
    // match the validator and is stripped.
    expect(r.stripped).toBe(1);
    expect(r.youtubeReplaced).toBe(0);
    expect(r.html).not.toContain('<iframe');
  });
});
