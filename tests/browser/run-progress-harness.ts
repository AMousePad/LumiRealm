import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['tests/browser/progress-fixture.ts'], target: 'browser' });
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
      await page.route('http://progress.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('.js') ? script : '<!doctype html><html><body><button id="outside">Continue browsing</button><div id="modules"></div></body></html>',
      }));
      await page.goto('http://progress.test/');
      await page.route('http://progress.test/api/v1/spindle-uploads**', route => route.fulfill({
        status: route.request().method() === 'POST' ? 201 : 204,
        headers: { 'Tus-Resumable': '1.0.0', Location: '/api/v1/spindle-uploads/upload-1', 'Upload-Offset': '4' },
      }));
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ type: 'module', content: `
        import { setupImportOverlay, mountModulesPanel } from '/fixture.js';
        const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
        const overlay = window.overlay = setupImportOverlay(log, () => {});
        window.sent = [];
        window.panel = mountModulesPanel({ root: document.querySelector('#modules'), log,
          sendToBackend(msg) { window.sent.push(msg); },
          onImportStart: (label, cancel, bytes) => overlay.notifyImportStart(label, 'module', cancel, bytes),
          onUploadProgress: (sent, total) => overlay.setUploadProgress(sent, total),
          onImportError: message => overlay.notifyImportError(message),
        });
        document.querySelector('#outside').onclick = () => document.body.dataset.clicked = 'yes';
        overlay.notifyImportStart('Example card', 'drawer', () => {});
        overlay.setUploadProgress(40, 100);
      ` });
      await page.getByRole('dialog', { name: 'Operation progress' }).waitFor();
      await page.getByRole('button', { name: 'Continue browsing' }).click({ timeout: 2000 });
      assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes');
      assert.equal(await page.locator('.lr-import-progress-fill').evaluate(el => (el as HTMLElement).style.width), '40%');
      assert.equal(await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true, includeHidden: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      assert.equal(await page.locator('.lr-import-progress').isVisible(), true);
      assert.equal(await page.locator('.lr-import-message').isVisible(), false);
      await page.getByRole('button', { name: 'Expand', exact: true }).click();
      assert.equal(await page.locator('.lr-import-message').isVisible(), true);
      const bounds = await page.locator('.lr-import-card').boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.lr-import-title').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('.lr-import-overlay').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true, includeHidden: true }).isDisabled(), false);
      await page.getByRole('tab', { name: 'Modules', exact: true }).click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true }).click();
      await (await chooser).setFiles({ name: 'example.risum', mimeType: 'application/octet-stream', buffer: Buffer.from('test') });
      await page.waitForFunction(() => (window as any).sent.some((msg: any) => msg.type === 'process_module_from_upload'));
      await page.evaluate(() => (window as any).panel.handleBackendMessage({ type: 'modules_pushed', modules: [], attached_by_character: {} }));
      assert.equal(await page.getByRole('button', { name: 'Importing module…', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.lr-import-title').textContent(), 'Importing example.risum');
      await page.evaluate(() => {
        const msg = { type: 'import_progress', phase: 'done', message: 'Imported', fraction: 1 };
        (window as any).overlay.handleBackendMessage(msg);
        (window as any).panel.handleBackendMessage(msg);
      });
      assert.equal(await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true }).isDisabled(), false);
      await page.evaluate(() => { (window as any).overlay.destroy(); (window as any).panel.destroy(); });
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: non-modal progress, minimize/expand/cancel, upload completion, shared busy controls and reduced motion pass`);
      await page.close();
    }
  } finally { await browser.close(); }
}

