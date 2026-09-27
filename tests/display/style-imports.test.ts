import { expect, test } from 'bun:test';
import { stripDisplayStyleImports } from '../../src/display/style-imports.js';

const reset = '.panel * { margin: 0; padding: 0; }';
test.each([
  '@import url("https://fonts.example.test/css?wght=400;700");',
  "@import 'https://fonts.example.test/a;b.css' screen;",
  '@IMPORT url(data:text/css;base64,AAAA);',
])('keeps following CSS after removing %s', rule => {
  const html = `<STYLE media="screen">${rule}${rule}${reset}</STYLE><div>text</div>`;
  const expected = `<STYLE media="screen">${reset}</STYLE><div>text</div>`;
  expect(stripDisplayStyleImports(html)).toBe(expected);
  expect(stripDisplayStyleImports(expected)).toBe(expected);
});
test('leaves non-style content and unrelated style rules unchanged', () => {
  const text = `@import url("a;b"); <div data-value="@import">text</div><style>${reset}@font-face{font-family:Demo;src:url(font.woff2)}</style>`;
  expect(stripDisplayStyleImports(text)).toBe(text);
});
test('leaves incomplete style blocks to the host streaming parser', () => {
  const text = '<style>@import url("a;b");';
  expect(stripDisplayStyleImports(text)).toBe(text);
});
