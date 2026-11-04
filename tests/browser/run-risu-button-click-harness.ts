import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/display/risu-button-click.ts'], target: 'browser', format: 'esm' });
assert.equal(built.success, true);
const handlerSource = (await built.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?/, '');

const page = await (await chromium.launch()).newPage();
const failures: string[] = [];
page.on('pageerror', (error) => failures.push(String(error)));

const markup = `
  <input type="radio" name="w" id="none" checked><input type="radio" name="w" id="set">
  <label id="open" for="set">open</label>
  <label id="close" for="none" risu-btn="win_close">x</label>
  <input type="checkbox" id="box" risu-btn="box_toggle">
  <details id="more"><summary id="sum" risu-btn="more">more</summary>body</details>
  <div risu-btn="wrap"><label><input type="checkbox" id="inner"><span id="wrapped">inner text label</span></label></div>
  <button id="plain" risu-trigger="fire" risu-id="7">fire</button>`;

async function load(install: string): Promise<void> {
  await page.setContent(markup);
  await page.evaluate(`
    ${handlerSource}
    window.sent = [];
    ${install}
  `);
}

const fixed = `document.addEventListener('click', createRisuButtonClickHandler({
  getChatId: () => 'chat', send: (message) => window.sent.push(message), log: { info() {}, warn() {} },
}), true);`;

await load(fixed);
await page.click('#open');
assert.equal(await page.isChecked('#set'), true, 'plain label opens');
await page.click('#close');
assert.equal(await page.isChecked('#none'), true, 'label with risu-btn still activates its radio');
await page.click('#box');
assert.equal(await page.isChecked('#box'), true, 'checkbox with risu-btn still toggles');
await page.click('#sum');
assert.equal(await page.getAttribute('#more', 'open'), '', 'summary with risu-btn still expands');
await page.click('#plain');
assert.deepEqual(await page.evaluate('window.sent'), [
  { type: 'manual_button_click', btn: 'win_close', chatId: 'chat' },
  { type: 'manual_button_click', btn: 'box_toggle', chatId: 'chat' },
  { type: 'manual_button_click', btn: 'more', chatId: 'chat' },
  { type: 'manual_trigger', triggerName: 'fire', triggerId: '7', chatId: 'chat' },
]);

// Risu's handler also sees the click the browser forwards from a label to its control.
await page.evaluate('window.sent.length = 0');
await page.click('#wrapped');
assert.equal(await page.evaluate('window.sent.length'), 2, 'forwarded label click dispatches again, as in Risu');
assert.equal(await page.isChecked('#inner'), true);

// Two rendered docks repeat the same ids, so a close label targets the first radio in the shared group.
await page.setContent(`<div id="a">${markup}</div><div id="b">${markup}</div>`);
await page.evaluate(`
  ${handlerSource}
  window.sent = [];
  ${fixed}
`);
await page.click('#b #open');
assert.equal(await page.isChecked('#a #set'), true, 'duplicate dock opens the first panel');
await page.click('#b #close');
assert.equal(await page.isChecked('#a #none'), true, 'close from the second dock reaches the shared group');
assert.equal(await page.isChecked('#a #set'), false);

// Control: the same steps must fail with a cancelled click, or this harness proves nothing.
await load(`document.addEventListener('click', (event) => {
  if (event.target.closest('[risu-btn]')) { event.preventDefault(); event.stopPropagation(); }
}, true);`);
await page.click('#open');
await page.click('#close');
assert.equal(await page.isChecked('#set'), true, 'control: cancelled click leaves the panel open');
await page.click('#box');
assert.equal(await page.isChecked('#box'), false, 'control: cancelled click reverts the checkbox');

assert.deepEqual(failures, []);
console.log('risu-button-click harness passed');
process.exit(0);
