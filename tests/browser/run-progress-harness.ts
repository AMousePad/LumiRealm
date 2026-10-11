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
      let holdPatch = false;
      let patchStarted = false;
      let releasePatch = (): void => {};
      await page.route('http://progress.test/api/v1/spindle-uploads**', async route => {
        assert.notEqual(route.request().method(), 'DELETE', 'host does not support TUS termination');
        if (route.request().method() === 'PATCH' && holdPatch) {
          patchStarted = true;
          await new Promise<void>(resolve => { releasePatch = resolve; });
        }
        await route.fulfill({
          status: route.request().method() === 'POST' ? 201 : 204,
          headers: { 'Tus-Resumable': '1.0.0', Location: '/api/v1/spindle-uploads/upload-1', 'Upload-Offset': '4' },
        });
      });
      await page.addStyleTag({ content: ':root { --lumiverse-fill: rgba(0, 0, 0, 0.15); --lumiverse-bg-opaque: rgb(28, 24, 38); --lumiverse-card-bg: linear-gradient(165deg, rgb(28, 24, 38), rgb(20, 17, 30)); --lumiverse-text: #eee; } body { background: repeating-linear-gradient(45deg, #888 0 12px, #ddd 12px 24px); }' + styles });
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
      const progressCard = page.locator('.lr-import-card');
      assert.equal(await progressCard.evaluate(el => getComputedStyle(el).backgroundImage), 'linear-gradient(165deg, rgb(28, 24, 38), rgb(20, 17, 30))', 'progress window must use the opaque theme surface');
      await page.evaluate(() => document.documentElement.style.setProperty('--lumiverse-card-bg', 'linear-gradient(165deg, rgb(252, 252, 252), rgb(242, 242, 242))'));
      assert.equal(await progressCard.evaluate(el => getComputedStyle(el).backgroundImage), 'linear-gradient(165deg, rgb(252, 252, 252), rgb(242, 242, 242))', 'progress window must follow light themes too');
      await page.evaluate(() => document.documentElement.style.removeProperty('--lumiverse-card-bg'));
      await page.screenshot({ path: `${process.env.TEMP}/lumirealm-progress-${engine.name()}-${width}.png` });
      await page.getByRole('button', { name: 'Continue browsing' }).click({ timeout: 2000 });
      assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes');
      assert.equal(await page.locator('.lr-import-progress-fill').evaluate(el => (el as HTMLElement).style.width), '40%');
      assert.equal(await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true, includeHidden: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      assert.equal(await progressCard.evaluate(el => getComputedStyle(el).backgroundImage), 'linear-gradient(165deg, rgb(28, 24, 38), rgb(20, 17, 30))');
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
      holdPatch = true;
      const cancelledChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true }).click();
      await (await cancelledChooser).setFiles({ name: 'cancelled.risum', mimeType: 'application/octet-stream', buffer: Buffer.from('test') });
      await page.locator('.lrm-status').filter({ hasText: 'Uploading cancelled.risum' }).waitFor();
      while (!patchStarted) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(await page.locator('.lr-import-progress').isVisible(), true);
      assert.match(await page.locator('.lr-import-message').innerText(), /Sent .* of 4 B/);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      releasePatch(); holdPatch = false;
      await page.waitForFunction(() => (window as any).sent.some((msg: any) => msg.type === 'cancel_module_import'));
      assert.equal(await page.locator('.lr-import-phase').textContent(), 'Cancelling');
      await page.evaluate(() => {
        const msg = { type: 'import_progress', phase: 'done', message: 'Module import cancelled', fraction: null, cancelled: true };
        (window as any).overlay.handleBackendMessage(msg);
        (window as any).panel.handleBackendMessage(msg);
        (window as any).sent = [];
      });
      assert.equal(await page.locator('.lrm-status').textContent(), '');
      await page.locator('.lr-import-overlay').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => (window as any).sent.some((msg: any) => msg.type === 'process_module_from_upload')), false);
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true }).click();
      await (await chooser).setFiles({ name: 'example.risum', mimeType: 'application/octet-stream', buffer: Buffer.from('test') });
      await page.waitForFunction(() => (window as any).sent.some((msg: any) => msg.type === 'process_module_from_upload'));
      await page.evaluate(() => (window as any).panel.handleBackendMessage({ type: 'modules_pushed', modules: [], attached_by_character: {} }));
      assert.equal(await page.getByRole('button', { name: 'Importing module…', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.lr-import-title').textContent(), 'Importing example.risum');
      await page.evaluate(() => {
        const msg = { type: 'import_progress', phase: 'uploading_assets', message: 'Uploading module assets (64/128)…', fraction: 0.6, cancellable: true };
        (window as any).overlay.handleBackendMessage(msg);
        (window as any).panel.handleBackendMessage(msg);
      });
      assert.match(await page.locator('.lr-import-message').innerText(), /64\/128/);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('.lr-import-overlay').isVisible(), true, 'keep progress visible until cancellation cleanup finishes');
      assert.equal(await page.locator('.lr-import-phase').textContent(), 'Cancelling');
      assert.equal(await page.getByRole('button', { name: 'Importing module…', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => (window as any).sent.some((msg: any) => msg.type === 'cancel_module_import' && msg.uploadId === 'upload-1')), true);
      await page.evaluate(() => {
        const msg = { type: 'import_progress', phase: 'done', message: 'Module import cancelled', fraction: null, cancelled: true };
        (window as any).overlay.handleBackendMessage(msg);
        (window as any).panel.handleBackendMessage(msg);
      });
      assert.equal(await page.getByRole('button', { name: 'Upload .risum / .charx', exact: true }).isDisabled(), false);
      assert.equal(await page.locator('.lrm-status').textContent(), '');
      assert.equal(await page.locator('.lr-import-phase').textContent(), 'Cancelled');
      assert.equal(await page.locator('.lr-import-progress-fill').evaluate(el => (el as HTMLElement).style.width), '0%');
      await page.evaluate(() => { (window as any).overlay.destroy(); (window as any).panel.destroy(); });
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${width}px: non-modal progress, minimize/expand/cancel, upload completion, shared busy controls and reduced motion pass`);
      await page.close();
    }
  } finally { await browser.close(); }
}

