import { chromium, firefox } from 'playwright';
import { resolve } from 'node:path';
import { snapshot } from '../helpers/display-lua-fixture';

const host = process.env.LUMIVERSE_DIR;
if (!host) throw Error('Set LUMIVERSE_DIR to the host checkout to test its actual rendering hooks.');
const out = resolve(process.env.DISPLAY_AUDIT_OUT ?? 'local/diagnostics/display-host-audit');
const frontend = await Bun.file('src/frontend.ts').text();
const ui = new Map<string, string[]>();
for (const match of frontend.matchAll(/import \{([^}]+)\} from '(\.\/(?:ui|bghtml|audio|realm)\/[^']+)'/g)) {
  ui.set(match[2]!, match[1]!.split(',').map(name => name.trim()));
}
const modules: Record<string, string> = {
  '@/store': 'export const useStore = selector => selector(globalThis.__hostState);',
  '@/lib/spindle/display-resolver-registry': 'export const isDisplayChatOwned = () => true; export const getDisplayResolverForChat = () => globalThis.__hostResolver;',
  '@/lib/chatDisplaySettle': 'export const trackInitialDisplayResolve = promise => promise;',
  '@/api/macros': 'export const resolveMacrosBatch = () => { throw Error("Unexpected macro transport"); };',
  '@/api/regex': 'export const regexApi = {reportPerformance(){throw Error("Unexpected regex transport")}};',
  '@/lib/toast': 'export const toast = {warning(message){throw Error(message)}};',
  '@/i18n': 'export default {t:key=>key};',
};
for (const variant of ['before', 'after']) {
  const built = await Bun.build({ entrypoints: ['tests/browser/display-host-lifecycle-entry.ts'], outdir: out + '/' + variant,
    target: 'browser', external: ['module'], define: { 'import.meta.env': '{}' }, plugins: [{ name: 'actual-host', setup(b) {
      b.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|@host\/.*|@\/.*)$/ }, args => {
        if (modules[args.path]) return { path: args.path, namespace: 'audit-stub' };
        if (args.path.startsWith('@host/')) return { path: resolve(host, 'frontend/src', args.path.slice(6) + '.ts') };
        if (args.path.startsWith('@/')) return { path: resolve(host, 'frontend/src', args.path.slice(2) + '.ts') };
        return { path: Bun.resolveSync(args.path, resolve(host, 'frontend')) };
      });
      b.onResolve({ filter: /^\.\/(?:ui|bghtml|audio|realm)\// }, args => {
        if (/[\\/]src[\\/]frontend\.ts$/.test(args.importer)) return { path: args.path, namespace: 'audit-ui' };
      });
      b.onLoad({ filter: /.*/, namespace: 'audit-stub' }, args => ({ contents: modules[args.path]!, loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'audit-ui' }, args => ({ loader: 'js', contents: (ui.get(args.path) ?? []).map(name =>
        name === 'STYLES' ? 'export const STYLES = "";' : name === 'isRealmBackendMessage' ? 'export const isRealmBackendMessage = () => false;'
          : `export const ${name} = () => new Proxy({}, {get: () => () => {}});`).join('\n') }));
      if (variant === 'before') b.onLoad({ filter: /[\\/]src[\\/]display[\\/]resolver\.ts$/ }, async args => ({ loader: 'ts', contents:
        (await Bun.file(args.path).text()).replace('if (liveSnap.luaTriggers.length > 0) {', 'if (liveSnap.luaTriggers.length > 0) { recorder.volatile = true;') }));
    } }] });
  if (!built.success) throw Error(built.logs.join('\n'));
}
const snap = snapshot(`listenEdit('editDisplay', function(id, text)
  setChatVar(id, 'writeOnly', text)
  return text..'|'..getChatVar(id, 'panelExpanded')
end)`);
snap.vars.local.panelExpanded = 'false';
const synthetic = { snap, inputs: Array.from({ length: 11 }, (_, index) => ({
  raw: 'Message ' + index,
  context: { chatId: snap.chatId, characterId: snap.characterId, messageId: 'message-' + index,
    messageIndex: index, role: 'assistant', isUser: false, depth: 10 - index }, scripts: [],
})) };
synthetic.snap = { ...snap, messagesHost: synthetic.inputs.map(row => ({ id: row.context.messageId, content: row.raw, role: 'assistant' })) };
const fixture = process.env.DISPLAY_FIXTURE ? await Bun.file(process.env.DISPLAY_FIXTURE).json() : synthetic;
const results: any = {};
for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const errors: string[] = [], samples: any = { before: [], after: [] };
    for (let sample = -1; sample < 3; sample++) for (const variant of sample % 2 ? ['after', 'before'] : ['before', 'after']) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
      await page.goto('http://display-audit.test');
      await page.evaluate(value => { (globalThis as any).__fixture = value; }, fixture);
      await page.addScriptTag({ type: 'module', content: await Bun.file(out + '/' + variant + '/display-host-lifecycle-entry.js').text() });
      const result = await page.evaluate(() => (globalThis as any).__runDisplayHost());
      if (result.requests.length) throw Error('Rendering used network transport');
      if (variant === 'after' && (result.opening.stoppedAtLimit || result.click.stoppedAtLimit)) throw Error('Persistence feedback did not terminate');
      if (variant === 'after' && (result.opening.bodyCalls !== fixture.inputs.length || result.click.bodyCalls === 0)) throw Error('Opening or relevant variable invalidation was skipped');
      if (variant === 'before' && !result.opening.stoppedAtLimit) throw Error('Baseline did not reproduce the feedback loop');
      if (result.reloadCalls !== fixture.inputs.length) throw Error('Explicit reload did not run every body');
      if (sample >= 0) samples[variant].push(result);
      await page.close();
    }
    if (errors.length) throw Error(errors.join('\n'));
    for (let sample = 0; sample < 3; sample++) {
      const before = samples.before[sample], after = samples.after[sample];
      if (JSON.stringify(before.outputs) !== JSON.stringify(after.outputs)) throw Error('Rendered output changed');
      if (JSON.stringify(before.finalVars) !== JSON.stringify(after.finalVars)) throw Error('Final authored state changed');
    }
    results[engine] = { version: browser.version(), samples };
    await Bun.write(out + '/' + engine + '.json', JSON.stringify(results[engine], null, 2));
    console.log(JSON.stringify({ engine, before: samples.before[0].opening, after: samples.after[0].opening,
      clickBefore: samples.before[0].click, clickAfter: samples.after[0].click }));
  } finally { await browser.close(); }
}
await Bun.write(out + '/results.json', JSON.stringify({ methodology: 'Actual host useDisplayRegexState, task scheduler, cache, regex pipeline and compiler; actual extension frontend setup, resolver and Wasmoon. Mocked store transport and unrelated UI. Persistence echoes delivered after a render batch; baseline censored after eight feedback rounds. One warmup and three alternating measured browser instances. Explicit GUI reload and panel variable invalidation are retained. Not a full live application or database benchmark.', results }, null, 2));
