import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/realm/frontend.ts'], target: 'browser' });
assert(built.success, built.logs.join('\n'));
const script = await built.outputs[0]!.text();

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://realm-browser.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('.js') ? script : '<!doctype html><html><body style="margin:0;background:#171717;color:#eee;font-family:system-ui,sans-serif"></body></html>',
      }));
      await page.goto('http://realm-browser.test/');
      await page.route('https://sv.risuai.xyz/resource/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#557bc5"/><stop offset="1" stop-color="#c89d65"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="200" cy="220" r="110" fill="#d9dfed"/></svg>' }));
      await page.addScriptTag({ type: 'module', content: `
        import { setupRealmModal } from '/realm.js';
        const sent = window.sent = [];
        const ctx = {
          settings: { get: async () => localStorage.getItem('realm:view'), set: async (_key, value) => { localStorage.setItem('realm:view', value); } },
          dom: { addStyle(css) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove(); } },
          ui: { showModal() {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;inset:20px;max-height:760px;display:flex;flex-direction:column;overflow:hidden;background:#222';
            const header = document.createElement('div'); header.textContent = 'RisuRealm'; header.style.padding = '12px 16px';
            const body = document.createElement('div'); body.id = 'host-scroll'; body.style.cssText = 'padding:16px;overflow-y:auto;flex:1';
            const root = document.createElement('div'); body.append(root); box.append(header, body); document.body.append(box);
            let dismiss = () => {}; return { root, onDismiss(fn) { dismiss = fn; }, dismiss() { box.remove(); dismiss(); } };
          } },
        };
        const realm = window.realm = setupRealmModal({ ctx, mountTarget: document.body, sendToBackend: msg => sent.push(msg), log: { info() {}, warn() {}, error() {} } });
        window.reply = (prefix, count = 40) => realm.handleBackendMessage({ type:'realm_search_result', requestId: sent.at(-1).requestId, ok:true,
          cards: Array.from({ length: count }, (_, i) => ({ id: prefix+i, name: prefix+i, desc:'A description for this example card.', img:i === 1 ? '' : 'example.svg', tags:['First tag','Another tag','Longer tag name','Fourth tag','Last tag'], download:1, hot:0, hasLore:false, hasEmotion:false, hasAsset:false, type:'character', viewScreen:'none', license:'' })) });
        realm.open(); window.reply('Initial');
      ` });
      await page.getByRole('button', { name: 'Recent', exact: true }).click();
      await page.evaluate(() => (window as any).reply('Recent'));
      await page.locator('.lr-realm-grid').evaluate(el => { (window as any).previousGrid = el; (window as any).previousCard = el.firstChild; });
      await page.getByTitle('Next page', { exact: true }).scrollIntoViewIfNeeded();
      const before = await page.locator('#host-scroll').evaluate(el => el.scrollTop);
      assert(before > 100, 'fixture must exercise a genuinely scrolled modal');
      await page.getByTitle('Next page', { exact: true }).click();
      await page.waitForTimeout(150);
      const blur = await page.locator('.lr-realm-grid').evaluate(el => parseFloat(getComputedStyle(el).filter.slice(5)));
      assert(blur > 0 && blur < 4, `blur should transition over 0.3 seconds: ${blur}`);
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), before);
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => el.firstChild === (window as any).previousCard), true);
      await page.evaluate(() => (window as any).reply('Next'));
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), before);
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => el === (window as any).previousGrid), true);
      assert.equal(await page.getByRole('spinbutton', { name: 'Page number', exact: true }).inputValue(), '2');
      await page.getByTitle('Previous page', { exact: true }).click();
      await page.evaluate(() => (window as any).reply('Previous'));
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), before);
      await page.getByRole('spinbutton', { name: 'Page number', exact: true }).fill('7');
      await page.getByRole('spinbutton', { name: 'Page number', exact: true }).press('Enter');
      assert.equal(await page.evaluate(() => (window as any).sent.at(-1).page), 6);
      await page.evaluate(() => (window as any).reply('Page7'));
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), before);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      const count = await page.evaluate(() => (window as any).sent.length);
      await page.getByLabel('View mode').selectOption('grid');
      assert.equal(await page.evaluate(() => (window as any).sent.length), count);
      await page.locator('.lr-realm-card').first().scrollIntoViewIfNeeded();
      const layout = await page.locator('.lr-realm-card').first().evaluate(el => {
        const rect = el.getBoundingClientRect();
        const image = el.querySelector('img')!.getBoundingClientRect();
        const text = el.querySelector('.lr-realm-card-body')!.getBoundingClientRect();
        const tags = el.querySelector('.lr-realm-tags')!;
        return { ratio: text.height / rect.height, imageRatio: image.height / rect.height, bottom: Math.abs(text.bottom - rect.bottom), tagRows: new Set(Array.from(tags.children).map(tag => tag.getBoundingClientRect().top)).size, overflow: getComputedStyle(tags).overflow };
      });
      assert(Math.abs(layout.ratio - 1 / 3) < 0.01 && layout.bottom < 2);
      assert(layout.imageRatio > 0.98);
      assert.equal(layout.tagRows, 1);
      assert.equal(layout.overflow, 'hidden');
      assert.equal(await page.locator('.lr-realm-card').nth(1).locator('.lr-realm-thumb-fallback').count(), 1);
      await page.locator('#host-scroll').evaluate(el => { el.scrollTop = 0; });
      await page.waitForFunction(() => (document.querySelector('.lr-realm-card img') as HTMLImageElement)?.complete);
      await page.screenshot({ path: `${process.env.TEMP}/lumirealm-grid-${engine.name()}-${width}.png` });
      await page.reload();
      await page.addScriptTag({ type: 'module', content: `
        import { setupRealmModal } from '/realm.js';
        document.body.dataset.savedView = localStorage.getItem('realm:view');
      ` });
      assert.equal(await page.locator('body').getAttribute('data-saved-view'), 'grid');
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: scroll retention, manual paging, blur, reduced motion, grid layout, single tag row, and saved preference pass`);
      await page.close();
    }
  } finally { await browser.close(); }
}
