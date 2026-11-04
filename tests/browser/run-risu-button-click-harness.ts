import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/display/risu-button-click.ts'], target: 'browser', format: 'esm' });
assert.equal(built.success, true);
const handlerSource = (await built.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?/, '');

const page = await (await chromium.launch()).newPage();
const failures: string[] = [];
page.on('pageerror', (error) => failures.push(String(error)));

const card = `
  <input type="radio" name="w" id="none" checked><input type="radio" name="w" id="set">
  <label id="open" for="set">open</label>
  <label id="close" for="none" risu-btn="win_close">x</label>
  <div id="plain-close" risu-btn="plain_close">x</div>
  <input type="checkbox" id="box" risu-btn="box_toggle">
  <input type="text" id="typed" value="initial">
  <details id="more"><summary id="sum">more</summary>body</details>
  <details id="open-more" open><summary id="open-sum">more</summary>body</details>
  <div id="fire" risu-trigger="fire" risu-id="7">fire</div>
  <div risu-btn="wrapped"><label><input type="checkbox" id="wrapped-box"><span id="wrapped-text">wrapped</span></label></div>
  <a id="link" href="#moved" risu-btn="link">link</a>
  <div id="scroller" style="height:20px;overflow:auto"><div style="height:400px">tall</div></div>
  <div id="failing" risu-btn="failing">failing</div>`;

async function load(install: string, ran = true): Promise<void> {
  await page.setContent(`
    <input type="checkbox" id="host-owned">
    <div id="background" risu-btn="bg">bg</div>
    <div data-message-id="m1"><div data-component="MessageContent">${card}</div><input type="checkbox" id="host-row"></div>`);
  await page.evaluate(`
    ${handlerSource}
    window.sent = []; window.invalidated = []; window.ran = ${ran};
    ${install}
  `);
}

const fixed = `document.addEventListener('click', createRisuButtonClickHandler({
  getChatId: () => 'chat',
  willRun: () => window.ran,
  run: async (message) => {
    window.sent.push(message);
    if (message.btn === 'failing') throw new Error('lua failed');
    return window.ran;
  },
  invalidateMessage: (id) => window.invalidated.push(id),
  log: { info() {}, warn() {}, error(message, error) { if (error.message !== 'lua failed') throw error; } },
}), true);`;

const settle = () => page.evaluate('new Promise((resolve) => setTimeout(resolve))');
const checked = (selector: string) => page.isChecked(selector);

await load(fixed);
await page.click('#open');
assert.equal(await checked('#set'), true, 'plain label opens');
assert.deepEqual(await page.evaluate('window.sent'), [], 'plain label dispatches nothing');
await page.click('#close');
await settle();
assert.equal(await checked('#none'), true, 'label with risu-btn closes');

await page.click('#open');
await page.click('#plain-close');
await settle();
assert.equal(await checked('#none'), true, 'a button with no native action still closes, through the reload');
assert.deepEqual(await page.evaluate('window.invalidated'), ['m1', 'm1']);

await page.click('#box');
await settle();
assert.equal(await checked('#box'), false, 'checkbox returns to its default after the reload like Risu');

await page.fill('#typed', 'user text');
await page.click('#sum');
await page.click('#open-sum');
await page.click('#host-owned');
await page.click('#host-row');
await page.click('#plain-close');
await settle();
assert.equal(await page.inputValue('#typed'), 'initial', 'typed text resets');
assert.equal(await page.getAttribute('#more', 'open'), null, 'opened details closes');
assert.equal(await page.getAttribute('#open-more', 'open'), '', 'closed default-open details reopens');
assert.equal(await checked('#host-owned'), true, 'controls outside the message are untouched');
assert.equal(await checked('#host-row'), true, 'host controls in the message row are untouched');

// A host patch adding `checked` must apply, which a touched control would ignore.
await page.click('#open');
await page.click('#plain-close');
await settle();
await page.evaluate(`document.getElementById('none').removeAttribute('checked'); document.getElementById('set').setAttribute('checked', '')`);
assert.equal(await checked('#set'), true, 'later attribute patches still drive the control');

await page.evaluate('window.sent.length = 0; window.invalidated.length = 0');
await page.click('#background');
await settle();
assert.deepEqual(await page.evaluate('window.sent'), [], 'buttons outside a message stay inert');

await page.click('#fire');
await settle();
assert.deepEqual(await page.evaluate('window.sent'), [{ type: 'manual_trigger', triggerName: 'fire', triggerId: '7', chatId: 'chat' }]);

await load(fixed);
await page.click('#wrapped-text');
await settle();
assert.equal((await page.evaluate<unknown[]>('window.sent')).length, 1, 'a label inside a button runs its trigger once');
assert.equal(await checked('#wrapped-box'), false, 'a label inside a running button does not toggle its control');

await page.click('#link');
await settle();
assert.equal(await page.evaluate('location.hash'), '', 'a running button does not navigate');

await page.evaluate(`document.getElementById('scroller').scrollTop = 200`);
await page.click('#plain-close');
await settle();
assert.equal(await page.evaluate(`document.getElementById('scroller').scrollTop`), 0, 'scroll position resets');

await page.click('#open');
await page.click('#failing');
await settle();
assert.equal(await checked('#none'), true, 'a failed run still reloads the message');

await load(fixed, false);
await page.click('#open');
await page.click('#plain-close');
await settle();
assert.equal(await checked('#set'), true, 'no reset when no trigger ran, matching Risu');
assert.deepEqual(await page.evaluate('window.invalidated'), []);

await page.click('#wrapped-text');
await settle();
assert.equal(await checked('#wrapped-box'), true, 'native activation stands when no trigger runs');

await page.setContent(`<div data-message-id="m1"><div data-component="MessageContent"><div id="island" data-lumiverse-html-island></div></div></div>`);
await page.evaluate(`
  ${handlerSource}
  window.sent = []; window.invalidated = []; window.ran = true;
  document.getElementById('island').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(card)};
  ${fixed}
`);
await page.click('#island #open');
await page.click('#island #plain-close');
await settle();
assert.equal(await checked('#island #none'), true, 'controls inside a shadow island reset');

// Control: the same steps must fail with a cancelled click, or this harness proves nothing.
await load(`document.addEventListener('click', (event) => {
  if (event.target.closest('[risu-btn]')) { event.preventDefault(); event.stopPropagation(); }
}, true);`);
await page.click('#open');
await page.click('#close');
assert.equal(await checked('#set'), true, 'control: cancelled click leaves the panel open');

assert.deepEqual(failures, []);
console.log('risu-button-click harness passed');
process.exit(0);
