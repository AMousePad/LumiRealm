import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/ui/modal-press-guard.ts'], target: 'browser' });
assert(built.success, built.logs.join('\n'));
const guardSource = (await built.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?/, '');

// Same backdrop, dialog and click rule as the host's showModal.
const page_html = `<!doctype html><body style="margin:0"><div id="backdrop" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center">
  <div id="dialog" style="width:300px;height:200px;background:#ccc"><div id="header" style="height:40px">title</div>
    <div id="body"><div id="root"><p id="text">Some selectable text in the dialog</p><button id="inner">inner</button></div></div></div></div></body>`;

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    const load = async (guarded: boolean): Promise<void> => {
      await page.setContent(page_html);
      await page.evaluate(`(() => {
        ${guardSource}
        window.closeCount = 0; window.inner = 0;
        const backdrop = document.getElementById('backdrop');
        backdrop.addEventListener('click', event => { if (event.target === backdrop) window.closeCount++; });
        document.getElementById('inner').addEventListener('click', () => window.inner++);
        ${guarded ? `window.removeGuard = guardModalPressRelease(document.getElementById('root'));` : ''}
      })()`);
    };
    const closed = () => page.evaluate<number>('window.closeCount');
    const drag = async (from: string, x: number, y: number): Promise<void> => {
      const box = (await page.locator(from).boundingBox())!;
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.up();
    };

    await load(false);
    await drag('#text', 20, 20);
    assert.equal(await closed(), 1, 'control: the host closes on a press released on the backdrop');

    await load(true);
    await drag('#text', 20, 20);
    assert.equal(await closed(), 0, 'a text drag released on the backdrop stays open');
    await drag('#header', 20, 20);
    assert.equal(await closed(), 0, 'a header drag released on the backdrop stays open');
    // Headless Firefox delivers no release outside the viewport, which leaves the mouse held for later steps.
    if (engine === chromium) {
      await drag('#text', -50, -50);
      assert.equal(await closed(), 0, 'a drag released outside the window stays open');
    }

    await page.click('#inner');
    assert.equal(await page.evaluate('window.inner'), 1, 'clicks inside the dialog still work');
    await drag('#text', 400, 300);
    assert.equal(await closed(), 0, 'a drag ending in the dialog stays open');

    await page.mouse.click(20, 20);
    assert.equal(await closed(), 1, 'a real backdrop click still closes');

    await page.evaluate('window.removeGuard()');
    await drag('#text', 20, 20);
    assert.equal(await closed(), 2, 'dismissing removes the guard');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
console.log('modal-press-guard harness passed');
process.exit(0);
