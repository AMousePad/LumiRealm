import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { engineCases } from './lua-engine-risu-cases';
import { risuSource, risuWrapperSlices, risuPrelude, risuJsonSha256 } from './lua-engine-risu-oracle';

// Run with: bun tests/browser/lua-engine-risu-harness.ts
// RISUAI_DIR optionally verifies the oracle against a local Risu checkout.
if (process.env.RISUAI_DIR) {
  const source = await Bun.file(join(process.env.RISUAI_DIR, 'src/ts/process/scriptings.ts')).text();
  const start = source.indexOf('function luaCodeWrapper(code:string)');
  assert(start >= 0, 'Risu luaCodeWrapper was not found');
  const body = source.slice(start, source.indexOf('export async function runLuaEditTrigger', start));
  const wrapper = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(body) + ';return luaCodeWrapper("");')() as string;
  const excerpts = risuWrapperSlices.map(([from, to]) => {
    const first = wrapper.indexOf(from);
    const last = wrapper.indexOf(to, first);
    assert(first >= 0 && last > first, `Risu wrapper boundaries changed: ${from}`);
    return wrapper.slice(first, last);
  });
  assert.equal('json = require "json"\n\n' + excerpts.join('\n'), risuPrelude, 'Pinned Risu wrapper differs from the checkout');
  const json = await Bun.file(join(process.env.RISUAI_DIR, 'public/lua/json.lua')).text();
  assert.equal(createHash('sha256').update(json.replace(/\r\n/g, '\n')).digest('hex'), risuJsonSha256);
}
const localJson = await Bun.file(new URL('../../src/interpreter/lua-json.lua', import.meta.url)).text();
assert.equal(createHash('sha256').update(localJson.replace(/\r\n/g, '\n')).digest('hex'), risuJsonSha256);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'lua-engine-risu-entry.ts')], target: 'browser', external: ['module'] });
assert(built.success, built.logs.join('\n'));
assert.equal(built.outputs.length, 1);
const browser = await (process.env.LUA_BROWSER === 'firefox' ? firefox : chromium).launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error(message.text()); });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('http://lua-engine.test/');
  await page.addScriptTag({ type: 'module', content: await built.outputs[0]!.text() });
  await page.waitForFunction(() => 'engineResults' in globalThis);
  const results = await page.evaluate(() => (globalThis as unknown as { engineResults: Promise<Record<string, unknown>[]> }).engineResults);
  const display = await page.evaluate(() => (globalThis as unknown as { displayResults: Promise<unknown> }).displayResults);
  assert.deepEqual(errors, []);
  assert.equal(results.length, engineCases.length);
  const failures: string[] = [];
  for (const [index, fixture] of engineCases.entries()) {
    const row = results[index]!;
    for (const kind of ['risu', 'wasmoon'] as const) {
      const expected = { values: fixture.expected };
      try {
        assert.deepEqual(row[kind], expected, `${kind}: ${fixture.name}`);
      } catch (error) {
        failures.push(String(error));
      }
    }
  }
  const report = { oracle: risuSource, browser: browser.version(), display, cases: results };
  if (process.env.LUA_ENGINE_RESULTS) await Bun.write(process.env.LUA_ENGINE_RESULTS, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, [], failures.join('\n'));
} finally {
  await browser.close();
}
