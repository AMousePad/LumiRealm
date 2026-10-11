import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/realm/frontend.ts'], target: 'browser' });
assert(built.success, built.logs.join('\n'));
const script = await built.outputs[0]!.text();

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const [width, height] of [[1920, 1440], [1280, 800], [390, 800], [844, 390]] as const) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://realm-browser.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('.js') ? script : '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-size:14px;line-height:1.5}input,button,textarea,select{font:inherit}@media(max-width:600px){input,textarea,select{font-size:max(16px,1em)!important}}</style></head><body style="margin:0;background:#171717;color:#eee;font-family:system-ui,sans-serif"></body></html>',
      }));
      await page.goto('http://realm-browser.test/');
      await page.route('https://sv.risuai.xyz/resource/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#557bc5"/><stop offset="1" stop-color="#c89d65"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="200" cy="220" r="110" fill="#d9dfed"/></svg>' }));
      await page.addScriptTag({ type: 'module', content: `
        import { setupRealmModal } from '/realm.js';
        const sent = window.sent = [];
        const ctx = {
          settings: { get: async () => localStorage.getItem('realm:view'), set: async (_key, value) => { localStorage.setItem('realm:view', value); } },
          dom: { addStyle(css) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove(); } },
          ui: { showModal(options) {
            const box = document.createElement('div');
            box.id = 'host-modal';
            box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;overflow:hidden;background:#222';
            box.style.width = Math.min(options.width, innerWidth - 40) + 'px'; box.style.maxHeight = Math.min(options.maxHeight, innerHeight - 40) + 'px';
            const header = document.createElement('div'); header.textContent = 'RisuRealm'; header.style.padding = '12px 16px';
            const body = document.createElement('div'); body.id = 'host-scroll'; body.style.cssText = 'padding:16px;overflow-y:auto;flex:1';
            const root = document.createElement('div'); body.append(root); box.append(header, body); document.body.append(box);
            let dismiss = () => {}; return { root, onDismiss(fn) { dismiss = fn; }, dismiss() { box.remove(); dismiss(); } };
          } },
        };
        const realm = window.realm = setupRealmModal({ ctx, mountTarget: document.body, sendToBackend: msg => sent.push(msg), log: { info() {}, warn() {}, error() {} } });
        window.reply = (prefix, count = 60) => realm.handleBackendMessage({ type:'realm_search_result', requestId: sent.at(-1).requestId, ok:true,
          cards: Array.from({ length: count }, (_, i) => ({ id: prefix+i, name: prefix+i, desc:'A longer description for this example card that wraps across multiple lines and should stay close to the tags.', img:i === 1 ? '' : 'example.svg', tags:['First tag','Another tag','Longer tag name','Fourth tag','Last tag'], download:1, hot:0, hasLore:false, hasEmotion:false, hasAsset:false, type:'character', viewScreen:'none', license:'' })) });
        realm.open(); window.reply('Initial');
      ` });
      await page.getByRole('button', { name: 'Recent', exact: true }).click();
      await page.evaluate(() => (window as any).reply('Recent'));
      await page.locator('.lr-realm-grid').evaluate(el => { (window as any).previousGrid = el; (window as any).previousCard = el.firstChild; });
      const toolbarBefore = await page.locator('.lr-realm-toolbar').boundingBox();
      const pagerBefore = await page.locator('.lr-realm-pager').boundingBox();
      await page.locator('.lr-realm-body').evaluate(el => { el.scrollTop = 500; });
      const before = await page.locator('.lr-realm-body').evaluate(el => el.scrollTop);
      assert.deepEqual(await page.locator('.lr-realm-toolbar').boundingBox(), toolbarBefore);
      assert.deepEqual(await page.locator('.lr-realm-pager').boundingBox(), pagerBefore);
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollTop), 0);
      assert(pagerBefore && pagerBefore.y + pagerBefore.height <= height);
      assert(before > 100, 'fixture must exercise a genuinely scrolled modal');
      await page.getByTitle('Next page', { exact: true }).click();
      await page.waitForTimeout(150);
      const blur = await page.locator('.lr-realm-grid').evaluate(el => parseFloat(getComputedStyle(el).filter.slice(5)));
      assert(blur > 0 && blur < 4, `blur should transition over 0.3 seconds: ${blur}`);
      assert.equal(await page.locator('.lr-realm-body').evaluate(el => el.scrollTop), before);
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => el.firstChild === (window as any).previousCard), true);
      await page.evaluate(() => (window as any).reply('Next'));
      assert.equal(await page.locator('.lr-realm-body').evaluate(el => el.scrollTop), 0);
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => el === (window as any).previousGrid), true);
      assert.equal(await page.getByRole('spinbutton', { name: 'Page number', exact: true }).inputValue(), '2');
      await page.getByTitle('Previous page', { exact: true }).click();
      await page.evaluate(() => (window as any).reply('Previous'));
      assert.equal(await page.locator('.lr-realm-body').evaluate(el => el.scrollTop), 0);
      await page.getByRole('spinbutton', { name: 'Page number', exact: true }).fill('7');
      await page.getByRole('spinbutton', { name: 'Page number', exact: true }).press('Enter');
      assert.equal(await page.evaluate(() => (window as any).sent.at(-1).page), 6);
      await page.evaluate(() => (window as any).reply('Page7'));
      assert.equal(await page.locator('.lr-realm-body').evaluate(el => el.scrollTop), 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.lr-realm-grid').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      const count = await page.evaluate(() => (window as any).sent.length);
      await page.getByRole('button', { name: 'Switch to grid view', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Switch to default view', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => (window as any).sent.length), count);
      await page.locator('.lr-realm-card').first().scrollIntoViewIfNeeded();
      const layout = await page.locator('.lr-realm-card').first().evaluate(el => {
        const rect = el.getBoundingClientRect();
        const image = el.querySelector('img')!.getBoundingClientRect();
        const text = el.querySelector('.lr-realm-card-body')!.getBoundingClientRect();
        const tags = el.querySelector('.lr-realm-tags')!;
        const stats = el.querySelector('.lr-realm-card-stats')!.getBoundingClientRect();
        const description = el.querySelector('.lr-realm-card-desc')!.getBoundingClientRect();
        return { squareRatio: rect.width / rect.height, tagGap: tags.getBoundingClientRect().top - description.bottom, gradient: getComputedStyle(el, '::after').backgroundImage, statsBottom: stats.bottom, textBottom: text.bottom, imageRatio: image.height / rect.height, bottom: Math.abs(text.bottom - rect.bottom), tagRows: new Set(Array.from(tags.children).map(tag => tag.getBoundingClientRect().top)).size, overflow: getComputedStyle(tags).overflow };
      });
      assert(Math.abs(layout.squareRatio - 1) < 0.01, 'grid cards must stay square');
      assert(layout.bottom < 2);
      assert(layout.tagGap >= 0 && layout.tagGap <= 4, 'tags must sit directly under the description');
      assert(layout.gradient.includes('rgba(0, 0, 0, 0) 20%'), 'gradient must begin transparent');
      assert(layout.gradient.includes('rgba(0, 0, 0, 0.95)'), 'gradient must darken smoothly beneath the text');
      assert(layout.imageRatio > 0.98);
      assert.equal(layout.tagRows, 1);
      assert.equal(layout.overflow, 'hidden');
      assert(layout.statsBottom <= layout.textBottom, 'card statistics must fit inside the overlay');
      assert.equal(await page.locator('.lr-realm-card').nth(1).locator('.lr-realm-thumb-fallback').count(), 1);
      await page.locator('.lr-realm-body').evaluate(el => { el.scrollTop = 0; });
      const gridLayout = await page.locator('.lr-realm-body').evaluate(el => {
        const cards = Array.from(el.querySelectorAll('.lr-realm-card')).map(card => card.getBoundingClientRect());
        return { columns: cards.filter(card => Math.abs(card.top - cards[0]!.top) < 1).length };
      });
      assert(gridLayout.columns <= 5);
      if (width === 1920) {
        assert.equal(Math.round((await page.locator('#host-modal').boundingBox())!.width), 1696);
        assert.equal(gridLayout.columns, 5);
      }
      assert.equal(await page.locator('#host-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 1), false);
      assert.equal(await page.locator('.lr-realm-root').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      await page.waitForFunction(() => (document.querySelector('.lr-realm-card img') as HTMLImageElement)?.complete);
      await page.screenshot({ path: `${process.env.TEMP}/lumirealm-grid-${engine.name()}-${width}.png` });
      await page.reload();
      await page.addScriptTag({ type: 'module', content: `
        import { setupRealmModal } from '/realm.js';
        document.body.dataset.savedView = localStorage.getItem('realm:view');
      ` });
      assert.equal(await page.locator('body').getAttribute('data-saved-view'), 'grid');
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: pinned controls, scroll reset, manual paging, blur, responsive grid, single tag row, and saved preference pass`);
      await page.close();
    }
  } finally { await browser.close(); }
}
