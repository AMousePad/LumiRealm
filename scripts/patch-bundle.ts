
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distBackend = join(import.meta.dir, '..', 'dist', 'backend.js');
const distRunner = join(import.meta.dir, '..', 'dist', 'regex-runner.js');

interface Patch {
  readonly name: string;
  readonly from: RegExp;
  readonly to: string;
}

const patches: readonly Patch[] = [
  {
    name: 'fengari (0, eval)("this") global-object polyfill',
    from: /\(0,\s*eval\)\("this"\)/g,
    to: 'globalThis',
  },
  {
    name: 'fengari Function("t","k","delete t[k]") delete-prop helper',
    from: /Function\(\s*"t"\s*,\s*"k"\s*,\s*"delete\s+t\[k\]"\s*\)/g,
    to: '((t,k)=>{delete t[k]})',
  },
  {
    name: 'fengari Function("return ()=>void 0;") noop factory',
    from: /Function\(\s*"return\s*\(\)=>void\s+0;?"\s*\)/g,
    to: '(()=>()=>void 0)',
  },
  {
    name: 'fengari Function("fengari", X) XHR library loader',
    from: /Function\(\s*"fengari"\s*,\s*\w+\s*\)/g,
    to: '(()=>{throw new Error("Function-constructor-disabled-in-extension-context")})()',
  },
];

interface Check {
  readonly label: string;
  readonly regex: RegExp;
}

const checks: readonly Check[] = [
  { label: 'filesystem module access',
    regex: /(?:from\s*["'`](?:node:)?fs(?:\/promises)?["'`]|require\s*\(\s*["'`](?:node:)?fs(?:\/promises)?["'`]\s*\)|import\s*\(\s*["'`](?:node:)?fs(?:\/promises)?["'`]\s*\))/ },
  { label: 'subprocess module access',
    regex: /(?:from\s*["'`](?:node:)?child_process["'`]|require\s*\(\s*["'`](?:node:)?child_process["'`]\s*\)|import\s*\(\s*["'`](?:node:)?child_process["'`]\s*\))/ },
  { label: 'direct socket module access',
    regex: /(?:from\s*["'`](?:node:)?(?:net|tls|dgram|http|https)["'`]|require\s*\(\s*["'`](?:node:)?(?:net|tls|dgram|http|https)["'`]\s*\)|import\s*\(\s*["'`](?:node:)?(?:net|tls|dgram|http|https)["'`]\s*\))/ },
  { label: 'worker or cluster module access',
    regex: /(?:from\s*["'`](?:node:)?(?:worker_threads|cluster)["'`]|require\s*\(\s*["'`](?:node:)?(?:worker_threads|cluster)["'`]\s*\)|import\s*\(\s*["'`](?:node:)?(?:worker_threads|cluster)["'`]\s*\))/ },
  { label: 'direct SQLite module access',
    regex: /(?:from\s*["'`](?:bun:sqlite|node:sqlite)["'`]|require\s*\(\s*["'`](?:bun:sqlite|node:sqlite)["'`]\s*\)|import\s*\(\s*["'`](?:bun:sqlite|node:sqlite)["'`]\s*\))/ },
  { label: 'dangerous Bun system API usage',
    regex: /\bBun\.(?:file|write|spawn|spawnSync|serve|connect|listen)\b/ },
  { label: 'dangerous process API usage',
    regex: /\bprocess\.(?:env|exit|kill|chdir|dlopen)\b/ },
  { label: 'direct eval() call (sandbox blocks at runtime)',
    regex: /(?<![A-Za-z0-9_$.])eval\s*\(/ },
  { label: 'Function constructor call (sandbox blocks at runtime)',
    regex: /(?<![A-Za-z0-9_$.])Function\s*\(/ },
  { label: 'AsyncFunction identifier (dynamic-exec via .constructor)',
    regex: /\bAsyncFunction\b/ },
  { label: 'GeneratorFunction identifier (dynamic-exec via .constructor)',
    regex: /\bGeneratorFunction\b/ },
  { label: 'bracket constructor access (dynamic-exec)',
    regex: /\[\s*["'`]constructor["'`]\s*\]/ },
  { label: '.constructor.constructor chain (dynamic-exec)',
    regex: /\.\s*constructor\s*\.\s*constructor\b/ },
  { label: '.constructor("...") string-compile call (dynamic-exec)',
    regex: /\.\s*constructor\s*\(\s*["'`][\s\S]{0,400}?["'`]\s*\)/ },
];

function processBundle(label: string, path: string): void {
  const original = readFileSync(path, 'utf-8');
  let patched = original;
  let totalHits = 0;
  for (const p of patches) {
    const before = patched;
    let hits = 0;
    patched = patched.replace(p.from, () => { hits += 1; return p.to; });
    if (hits > 0) {
      console.log(`[${label}] patched ${hits} x ${p.name}`);
      totalHits += hits;
    }
    if (patched === before && hits > 0) {
      throw new Error(`internal: counted ${hits} hits but content unchanged for ${p.name}`);
    }
  }
  if (patched !== original) {
    writeFileSync(path, patched, 'utf-8');
    console.log(`[${label}] wrote ${totalHits} patch(es)`);
  }

  let failed = false;
  for (const c of checks) {
    const m = patched.match(c.regex);
    if (m) {
      const idx = patched.indexOf(m[0]);
      const ctx = patched.substring(Math.max(0, idx - 60), Math.min(patched.length, idx + m[0].length + 60))
        .replace(/\r?\n/g, ' ');
      if (process.env.LUMIREALM_SKIP_SAFETY_CHECK === '1') {
        console.warn(`[${label}] static safety check SKIPPED (LUMIREALM_SKIP_SAFETY_CHECK=1): ${c.label}`);
        continue;
      }
      console.error(`[${label}] STATIC SAFETY CHECK FAIL: ${c.label}\n  context: ...${ctx}...`);
      failed = true;
    }
  }
  if (failed) {
    console.error(`\n[${label}] Lumi's detectDangerousBackendCapabilities (commit 5195652) would block this bundle.`);
    console.error("Fix the source (or extend patches above) before committing dist/.");
    process.exit(1);
  }
  console.log(`[${label}] static safety check passed (${checks.length} patterns clean)`);
}

processBundle('backend', distBackend);

// regex-runner.js is a separate --target bun bundle the host spawns as a managed
// backend process. It gets the same patch + safety check (deploy.ps1 already does).
if (existsSync(distRunner)) {
  processBundle('regex-runner', distRunner);
}
