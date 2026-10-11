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
        body: route.request().url().endsWith('.js') ? script : '<!doctype html><html><body style="margin:0;background:#171717"></body></html>',
      }));
      await page.goto('http://realm-browser.test/');
      await page.addScriptTag({ type: 'module', content: `
        import { setupRealmModal } from '/realm.js';
        const sent = window.sent = [];
        const ctx = {
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
          cards: Array.from({ length: count }, (_, i) => ({ id: prefix+i, name: prefix+i, desc:'A description for this example card.', img:'', tags:['First tag','Another tag','Longer tag name','Fourth tag','Last tag'], download:1, hot:0, hasLore:false, hasEmotion:false, hasAsset:false, type:'character', viewScreen:'none', license:'' })) });
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
      assert.equal(await page.locator('.lr-realm-pager-page').textContent(), '2');
      await page.getByTitle('Previous page', { exact: true }).click();
      await page.evaluate(() => (window as any).reply('Previous'));
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), before);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: retained results, next/previous scroll, 0.3s blur, and reduced motion pass`);
      await page.close();
    }
  } finally { await browser.close(); }
}
