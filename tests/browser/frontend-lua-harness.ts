import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

let oracleSource: string | undefined;
if (process.env.RISUAI_DIR) {
  const root = process.env.RISUAI_DIR;
  const revision = Bun.spawnSync(['git', '-C', root, 'rev-parse', 'HEAD']).stdout.toString().trim();
  assert.equal(revision, '669b12ceabe1c5066d3dadbe0973f2188d10cc97', 'Review the Risu oracle before changing its revision');
  const source = await Bun.file(root + '/src/ts/process/scriptings.ts').text();
  const ast = ts.createSourceFile('scriptings.ts', source, ts.ScriptTarget.Latest, true);
  const stripped = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !(ts.isClassDeclaration(statement) && statement.name?.text === 'PyodideContext')).map(statement => statement.getFullText(ast)).join('\n').replace(/^export /gm, '');
  const mutex = (await Bun.file(root + '/src/ts/mutex.ts').text()).replace(/^export /gm, '');
  const parserSource = await Bun.file(root + '/src/ts/parser/parser.svelte.ts').text();
  const parser = ts.createSourceFile('parser.ts', parserSource, ts.ScriptTarget.Latest, true);
  const hasher = parser.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'hasher');
  assert(hasher);
  oracleSource = new Bun.Transpiler({ loader: 'ts' }).transformSync(mutex + '\n' + stripped + '\n' + hasher.getFullText(parser).replace(/export /, ''));
}

const built = await Bun.build({ entrypoints: [fileURLToPath(new URL('./frontend-lua-entry.ts', import.meta.url))], target: 'browser', external: ['module'] });
assert(built.success, built.logs.join('\n'));
assert.equal(built.outputs.length, 1);
const browser = await (process.env.LUA_BROWSER === 'firefox' ? firefox : chromium).launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('http://localhost/');
  if (oracleSource) await page.evaluate(source => { Object.assign(globalThis, { risuOracleSource: source }); }, oracleSource);
  await page.addScriptTag({ type: 'module', content: await built.outputs[0]!.text() });
  await page.waitForFunction(() => 'frontendLuaResult' in globalThis);
  const result = await page.evaluate(() => (globalThis as unknown as { frontendLuaResult: Promise<unknown> }).frontendLuaResult);
  console.log(JSON.stringify({ browser: browser.version(), result }));
} finally { await browser.close(); }
