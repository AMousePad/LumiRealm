import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/ui/searchable-select.ts'], target: 'browser' });
assert(built.success, built.logs.join('\n'));
const script = await built.outputs[0]!.text();
const styles = await Bun.file('src/ui/styles.css').text();

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://module-selector.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('.js') ? script : '<!doctype html><html><head></head><body></body></html>',
      }));
      await page.goto('http://module-selector.test/');
      // Lumiverse's viewport drawer sits at 9992; body-mounted menus must clear it.
      await page.setContent('<div id="drawer" style="position:fixed;inset:0 0 0 auto;width:min(380px,100vw);z-index:9992;background:#222;padding-top:100px"></div>');
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ type: 'module', content: `
        import { createSearchableSelect } from '/searchable-select.js';
        window.selector = createSearchableSelect({
          items: [{ value: 'module-1', label: 'Example module' }],
          placeholder: 'Select a module',
          onChange(value) { document.body.dataset.selected = value; },
        });
        document.querySelector('#drawer').append(window.selector.root);
      ` });
      const trigger = page.getByRole('button', { name: 'Select a module' });
      await trigger.click();
      const option = page.getByRole('option', { name: 'Example module' });
      await option.click({ timeout: 2000 });
      assert.equal(await page.locator('body').getAttribute('data-selected'), 'module-1');
      await page.getByRole('button', { name: 'Example module' }).focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Example module' }).getAttribute('aria-expanded'), 'false');
      await page.evaluate(() => (window as any).selector.destroy());
      assert.equal(await page.locator('.lr-ss-panel').count(), 0);
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: selector visible, selectable, keyboard accessible, and cleaned up`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
