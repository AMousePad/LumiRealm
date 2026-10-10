import { describe, expect, test } from 'bun:test';
import { ISLAND_TRIGGER_PREFIX, stripLegacyIslandWrappers } from '../../../src/core/mappers/island-merge.js';
import { STYLE_WRAP_OPEN } from '../../../src/util/sanitizer-doc-shape.js';

const WRAP = STYLE_WRAP_OPEN + ISLAND_TRIGGER_PREFIX;

const CBG_BODY = `<div class="background-container">
  <img class="fullBgImage2" src="sky.png">
  </div>
<div class="simpleFrame">
  <div class="time-display"><div class="time-text">$5</div></div>
  <img class="backgroundImage" src="$2">
  <div class="number-label">$1</div>`;

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
