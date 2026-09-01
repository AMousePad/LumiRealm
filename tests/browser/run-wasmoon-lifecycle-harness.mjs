import { chromium } from 'playwright';

console.log('launching');
const browser = await chromium.launch({ headless: true, timeout: 15_000 });
try {
  console.log('launched');
  const page = await browser.newPage();
  page.on('console', (message) => console.log(`page:${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  await page.goto('http://127.0.0.1:41873/wasmoon-lifecycle-harness.html', {
    timeout: 15_000,
  });
  console.log('loaded');
  await page.locator('body').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.body.dataset.status !== 'running', undefined, {
    timeout: 15_000,
  });
  const status = await page.locator('body').getAttribute('data-status');
  const result = await page.locator('pre').innerText();
  console.log(result);
  if (status !== 'pass') process.exitCode = 1;
} finally {
  await browser.close();
}
