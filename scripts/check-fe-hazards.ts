import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ENTRY = resolve(ROOT, 'src/frontend.ts');
const BUNDLE = resolve(ROOT, 'dist/frontend.js');

const ALLOWLIST = new Set<string>([
  resolve(ROOT, 'src/interpreter/runtime/als-compat.ts'),
]);

interface Rule { rule: string; re: RegExp; allowTypeImport?: boolean }
const RULES: Rule[] = [
  { rule: 'node:-import', re: /\bfrom\s*['"]node:/, allowTypeImport: true },
  { rule: 'node:-require', re: /\brequire\(\s*['"]node:/ },
  { rule: 'node-Buffer', re: /\bBuffer\.(from|alloc|allocUnsafe|concat|isBuffer|byteLength)\b/ },
  { rule: 'node-Buffer', re: /\bnew\s+Buffer\b/ },
  { rule: 'node-process', re: /\bprocess\.(env|cwd|platform|version|argv|nextTick|hrtime|exit)\b/ },
  { rule: 'bun-global', re: /\bBun\./ },
  { rule: 'async-local-storage', re: /\bnew\s+AsyncLocalStorage\b/ },
];

interface Violation { file: string; line: number; rule: string; text: string }

function stripComments(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

function resolveImport(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec).replace(/\.js$/, '');
  for (const c of [base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const BUNDLE_RULES: { rule: string; re: RegExp }[] = [
  { rule: 'node-Buffer', re: /Buffer\.(from|alloc|concat)\(/g },
  { rule: 'node-Buffer', re: /new Buffer\(/g },
  { rule: 'node-process', re: /\bprocess\.(env|cwd|platform)\b/g },
  { rule: 'bun-global', re: /\bBun\.[a-zA-Z]/g },
];

// _hasBuffer is js-base64's `typeof Buffer !== 'undefined'` self-guard pulled in
// via tus-js-client. The Buffer path is dead in the browser.
const SANCTION_MARKERS: RegExp[] = [/process\.stdin\.fd/, /_hasBuffer/];
const SANCTION_WINDOW = 80;

function isSanctioned(text: string, idx: number): boolean {
  const slice = text.slice(Math.max(0, idx - SANCTION_WINDOW), idx + SANCTION_WINDOW);
  return SANCTION_MARKERS.some((m) => m.test(slice));
}

function scanBundle(): { rule: string; hits: number }[] {
  if (!existsSync(BUNDLE)) return [];
  const text = readFileSync(BUNDLE, 'utf8');
  const out: { rule: string; hits: number }[] = [];
  for (const r of BUNDLE_RULES) {
    let hits = 0;
    for (const m of text.matchAll(r.re)) {
      if (m.index !== undefined && isSanctioned(text, m.index)) continue;
      hits += 1;
    }
    if (hits > 0) out.push({ rule: r.rule, hits });
  }
  return out;
}

const visited = new Set<string>();
const queue = [ENTRY];
const violations: Violation[] = [];
while (queue.length) {
  const file = queue.pop()!;
  if (visited.has(file)) continue;
  visited.add(file);
  const src = readFileSync(file, 'utf8');
  if (!ALLOWLIST.has(file)) {
    const lines = stripComments(src).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const r of RULES) {
        if (!r.re.test(line)) continue;
        if (r.allowTypeImport && /^\s*(import|export)\s+type\b/.test(line)) continue;
        violations.push({ file: file.slice(ROOT.length + 1), line: i + 1, rule: r.rule, text: line.trim().slice(0, 100) });
      }
    }
  }
  for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
    const r = resolveImport(m[1]!, file);
    if (r) queue.push(r);
  }
  for (const m of src.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) {
    const r = resolveImport(m[1]!, file);
    if (r) queue.push(r);
  }
}

const bundleHits = scanBundle();

if (violations.length === 0 && bundleHits.length === 0) {
  console.log(`[check-fe-hazards] OK: scanned ${visited.size} FE-reached source files + bundle, no node:/Buffer/process/Bun hazards.`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`[check-fe-hazards] ${violations.length} source hazard(s) in the FE-reached graph (these crash the browser bundle at runtime, not build):`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
}
if (bundleHits.length > 0) {
  console.error(`[check-fe-hazards] node hazard(s) present in dist/frontend.js:`);
  for (const h of bundleHits) console.error(`  [${h.rule}]  ${h.hits} occurrence(s)`);
}
console.error(`[check-fe-hazards] Fix: route through a pure/browser-safe helper (e.g. util/base64 bytesToBase64) or guard behind als-compat-style typeof shim. Allowlist a sanctioned shim in this script only if it self-guards.`);
process.exit(1);
