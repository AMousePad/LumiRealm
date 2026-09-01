import { describe, expect, test } from 'bun:test';
import {
  MESSAGE_ISLAND_OPEN,
  normalizeBlockBalance,
  wrapResolvedContentAsIsland,
} from '../../src/display/fragment-assembly.js';
import {
  ISLAND_TRIGGER_PREFIX,
  stripLegacyIslandWrappers,
} from '../../src/core/mappers/island-merge.js';
import {
  STYLE_WRAP_OPEN,
  STYLE_WRAP_CLOSE,
} from '../../src/util/sanitizer-doc-shape.js';

const WRAP = STYLE_WRAP_OPEN + ISLAND_TRIGGER_PREFIX;

// Raw rule fragments mirror a VN-scene card: the scene opener leaves
// simpleFrame open, character rules carry an extra close, the text opener
// leaves two containers open, dialogue lines are inline fragments.
const CBG_BODY = `<div class="background-container">
  <img class="fullBgImage2" src="sky.png">
  </div>
<div class="simpleFrame">
  <div class="time-display"><div class="time-text">$5</div></div>
  <img class="backgroundImage" src="$2">
  <div class="number-label">$1</div>`;

const CLIPPER_BODY = `<div class="character-clipper1">
    <img class="characterImage1" src="$1">
  </div>
</div>`;

const TEXT_BODY = `<div class="text-area-container">
  <label class="textarea-toggle-button">fold</label>
<div class="text-area">`;

function stackAt(text: string, needle: string): string[] {
  const target = text.indexOf(needle);
  expect(target).toBeGreaterThanOrEqual(0);
  const stack: string[] = [];
  const tagRe = /<div\b[^>]*>|<\/div\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    if (m.index >= target) break;
    if (m[0].startsWith('</')) stack.pop();
    else stack.push(/class="([^"]*)"/.exec(m[0])?.[1] ?? '');
  }
  return stack;
}

describe('stripLegacyIslandWrappers', () => {
  test('strips wrap + trigger + appended close from a fragment row', () => {
    const stored = `${WRAP}${CBG_BODY}\n</div>`;
    expect(stripLegacyIslandWrappers(stored)).toBe(`${CBG_BODY}\n`);
  });

  test('strips wrap + trigger from a balanced row', () => {
    const body = '<div class="panel"><span>hi</span></div>';
    expect(stripLegacyIslandWrappers(`${WRAP}${body}</div>`)).toBe(body);
  });

  test('strips a bare trigger prefix', () => {
    expect(stripLegacyIslandWrappers(`${ISLAND_TRIGGER_PREFIX}<p>x</p>`)).toBe('<p>x</p>');
  });

  test('strips the island-merge wrapper', () => {
    const body = '<div class="a">1</div><div class="b">2</div>';
    const stored = `<div data-risu-island-merge style="display:contents">${body}</div>`;
    expect(stripLegacyIslandWrappers(stored)).toBe(body);
  });

  test('strips nested wrap + trigger + merge layering', () => {
    const body = '<div class="a">1</div><div class="b">2</div>';
    const stored = `${WRAP}<div data-risu-island-merge style="display:contents">${body}</div></div>`;
    expect(stripLegacyIslandWrappers(stored)).toBe(body);
  });

  test('wrap prefix without trailing close returns unchanged', () => {
    const edited = `${WRAP}<div class="x">`;
    expect(stripLegacyIslandWrappers(edited)).toBe(edited);
  });

  test('raw rows pass through unchanged (idempotent)', () => {
    expect(stripLegacyIslandWrappers(CBG_BODY)).toBe(CBG_BODY);
    expect(stripLegacyIslandWrappers('</div>')).toBe('</div>');
    expect(stripLegacyIslandWrappers('plain **text**')).toBe('plain **text**');
  });
});

describe('normalizeBlockBalance', () => {
  test('balanced content passes through unchanged', () => {
    const s = '<div><div>x</div></div><section>y</section>';
    expect(normalizeBlockBalance(s)).toBe(s);
  });

  test('appends missing closes in reverse order', () => {
    expect(normalizeBlockBalance('<div class="a"><section>')).toBe(
      '<div class="a"><section></section></div>',
    );
  });

  test('drops stray closes', () => {
    expect(normalizeBlockBalance('<div>x</div></div>after')).toBe('<div>x</div>after');
  });

  test('close pops through intermediate opens', () => {
    const s = '<div><section></div>';
    expect(normalizeBlockBalance(s)).toBe(s);
  });

  test('quoted attribute angle brackets are ignored', () => {
    const s = '<div title="</div>">x</div>';
    expect(normalizeBlockBalance(s)).toBe(s);
  });

  test('style content is opaque', () => {
    const s = '<style>.x { color: red }</style>';
    expect(normalizeBlockBalance(s)).toBe(s);
  });

  test('inline tags do not participate', () => {
    const s = '<p><span class="log">line';
    expect(normalizeBlockBalance(s)).toBe(s);
  });
});

describe('wrapResolvedContentAsIsland', () => {
  const scene1 =
    `${CBG_BODY}\n`
    + `\n\n</div>\n`
    + `\n\n${TEXT_BODY}`
    + `\n<p><span class="log">line one`
    + `\n\n**Pipipipipi**\n\n`
    + `<p><span class="log">line two`
    + `\n</div></div>`;

  const scene2 =
    `${CBG_BODY}\n`
    + `\n${CLIPPER_BODY}`
    + `\n${TEXT_BODY}`
    + `\n<p><span class="risa">"Huh?"`
    + `\n</div></div>`;

  const prose = '## Volume 1\n\nstatus line\n\n---\n\n';
  const msg = `${prose}${scene1}\n\n${scene2}\n`;

  test('pure markdown stays unwrapped', () => {
    expect(wrapResolvedContentAsIsland('plain **text** only')).toBe('plain **text** only');
    expect(wrapResolvedContentAsIsland('')).toBe('');
  });

  test('inline-only HTML stays unwrapped', () => {
    expect(wrapResolvedContentAsIsland('a <b>bold</b> word')).toBe('a <b>bold</b> word');
  });

  test('block content wraps into exactly one balanced island', () => {
    const out = wrapResolvedContentAsIsland(msg);
    expect(out.startsWith(`${MESSAGE_ISLAND_OPEN}${ISLAND_TRIGGER_PREFIX}`)).toBe(true);
    expect(out.endsWith(STYLE_WRAP_CLOSE)).toBe(true);
    expect(out.split('data-lr-style-wrap').length - 1).toBe(1);
    expect(normalizeBlockBalance(out)).toBe(out);
  });

  test('island wrapper carries Risu chat metrics scaled by the host font scale', () => {
    const out = wrapResolvedContentAsIsland(msg);
    expect(out).toContain('font-size:calc(0.875rem * var(--lumiverse-font-scale, 1))');
    expect(out).toContain('line-height:calc(1.25rem * var(--lumiverse-font-scale, 1))');
  });

  test('character clipper nests inside simpleFrame', () => {
    const out = wrapResolvedContentAsIsland(msg);
    const stack = stackAt(out, 'character-clipper1');
    expect(stack).toContain('simpleFrame');
  });

  test('scene one frame is closed before its text container opens', () => {
    const out = wrapResolvedContentAsIsland(msg);
    const stack = stackAt(out, 'text-area-container');
    expect(stack).not.toContain('simpleFrame');
  });

  test('dialogue and interleaved markdown sit inside the text area', () => {
    const out = wrapResolvedContentAsIsland(msg);
    expect(stackAt(out, 'line one')).toContain('text-area');
    expect(stackAt(out, '**Pipipipipi**')).toContain('text-area');
  });

  test('style-bearing content wraps even without block tags', () => {
    const s = '<style>.x { color: red }</style>text';
    const out = wrapResolvedContentAsIsland(s);
    expect(out.startsWith(MESSAGE_ISLAND_OPEN)).toBe(true);
  });

  test('truncated stream gets auto-closed', () => {
    const truncated = `${prose}${CBG_BODY}\nunfinished line`;
    const out = wrapResolvedContentAsIsland(truncated);
    expect(out.endsWith(`</div>${STYLE_WRAP_CLOSE}`)).toBe(true);
    expect(normalizeBlockBalance(out)).toBe(out);
  });
});
