import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { rescopeRisuEnvironment } from '../../src/bghtml/island-styles.js';
import { wrapResolvedContentAsIsland } from '../../src/display/fragment-assembly.js';

// Run with bun tests/bghtml/island-typography.browser.ts after playwright install chromium.
const bundle = await Bun.file(new URL('../../src/bghtml/risu-environment.css', import.meta.url)).text();
const css = rescopeRisuEnvironment(bundle).css;
const html = wrapResolvedContentAsIsland(`<div><p id="plain">Plain <span id="nested">nested</span></p>
<div class="card"><span id="card-child">Card</span></div>
<div style="font-family:monospace;font-size:22px;line-height:44px"><span id="inline-child">Inline</span></div>
<div style="--risu-font-family:cursive"><span id="variable">Variable</span></div></div>`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="reader"><p id="native">Native</p><div id="island"></div></div>');
  const results = await page.evaluate(({ css, html }) => {
    const reader = document.querySelector<HTMLElement>('#reader')!;
    const shadow = document.querySelector('#island')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
    const environment = new CSSStyleSheet();
    environment.replaceSync(css);
    const card = new CSSStyleSheet();
    card.replaceSync('.card{font-family:monospace;font-size:24px;line-height:48px}');
    shadow.adoptedStyleSheets = [environment, card];
    function metrics(el: Element) {
      const s = getComputedStyle(el);
      return [s.fontFamily, s.fontSize, s.lineHeight];
    }
    return ['font-family:serif;font-size:19px;line-height:31px',
      'font-family:sans-serif;font-size:25px;line-height:42px'].map(theme => {
      reader.style.cssText = theme;
      return {
        native: metrics(document.querySelector('#native')!),
        plain: metrics(shadow.querySelector('#plain')!),
        nested: metrics(shadow.querySelector('#nested')!),
        card: metrics(shadow.querySelector('#card-child')!),
        inline: metrics(shadow.querySelector('#inline-child')!),
        variable: metrics(shadow.querySelector('#variable')!),
      };
    });
  }, { css, html });
  for (const result of results) {
    assert.deepEqual(result.plain, result.native);
    assert.deepEqual(result.nested, result.native);
    assert.deepEqual(result.card, ['monospace', '24px', '48px']);
    assert.deepEqual(result.inline, ['monospace', '22px', '44px']);
    assert.equal(result.variable[0], 'cursive');
  }
  console.log('PASS: shadow typography inherits both host themes and preserves explicit card styles');
} finally {
  await browser.close();
}
