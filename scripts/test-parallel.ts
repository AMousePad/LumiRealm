#!/usr/bin/env bun
/**
 * Runs all workspace test files in parallel, one process per file, with a
 * configurable concurrency cap. Results print in finish order, not spawn
 * order, so failures surface early, and the exit code is the max of all
 * child exits.
 *
 * Usage:
 *   bun scripts/test-parallel.ts [--concurrency N] [--filter pattern]
 *
 * Defaults: concurrency=13. Filter is a substring match on the test file path.
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

interface Args {
  concurrency: number;
  filter: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { concurrency: 13, filter: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--filter") out.filter = argv[++i] ?? null;
    else if (a === "-h" || a === "--help") {
      console.log("usage: bun scripts/test-parallel.ts [--concurrency N] [--filter SUBSTR]");
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.concurrency) || out.concurrency < 1) {
    throw new Error(`bad --concurrency ${out.concurrency}`);
  }
  return out;
}

const ROOT = resolve(import.meta.dir, "..");

// Collects every .test.ts under tests/, sorted by DESCENDING file size:
// LPT (Longest-Processing-Time-first) scheduling, so the biggest jobs feed
// the pool first and short jobs fill gaps at the end, keeping makespan
// within 4/3 of optimal for any worker count. File size is an imperfect
// proxy for test cost (corpus sweeps can be short in lines but long in
// wall time) but still beats alphabetical order.
function findTestFiles(): string[] {
  // Second root is the optional private overlay, absent on clones.
  const roots = [join(ROOT, "tests"), join(ROOT, "local", "tests")];
  const files: { path: string; size: number }[] = [];
  for (const testsDir of roots) {
    try { statSync(testsDir); } catch { continue; }
    for (const f of walk(testsDir)) {
      if (!f.endsWith(".test.ts")) continue;
      files.push({ path: f, size: statSync(f).size });
    }
  }
  files.sort((a, b) => b.size - a.size);
  return files.map((f) => f.path);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

interface JobResult {
  readonly file: string;
  readonly code: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn bun-test-file and collect its output. We run each file in its
 * own process so a crashing test takes down only its own worker, and so
 * corpus sweeps parallelize across cores instead of serializing in one
 * process.
 */
async function runOne(file: string): Promise<JobResult> {
  const start = Date.now();
  const proc = Bun.spawn(["bun", "test", file], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { file, code, durationMs: Date.now() - start, stdout, stderr };
}

/**
 * Bounded-concurrency pool: starts up to `N` workers, each pulling the next
 * file from a shared queue, and yields in completion order so callers can
 * print results as they land.
 */
async function* runPool(files: readonly string[], concurrency: number): AsyncGenerator<JobResult> {
  let next = 0;
  const active = new Set<Promise<JobResult>>();

  const spawn = (): Promise<JobResult> | null => {
    if (next >= files.length) return null;
    const file = files[next++]!;
    const p = runOne(file).then((r) => {
      active.delete(p);
      return r;
    });
    active.add(p);
    return p;
  };

  while (active.size < concurrency && spawn() !== null) { /* fill pool */ }
  while (active.size > 0) {
    const done = await Promise.race(active);
    yield done;
    spawn();
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const allFiles = findTestFiles();
const files = args.filter ? allFiles.filter((f) => f.includes(args.filter!)) : allFiles;

if (files.length === 0) {
  console.error("no test files found");
  process.exit(2);
}

const concurrency = Math.min(args.concurrency, files.length);
console.error(`[test-parallel] ${files.length} files, concurrency=${concurrency}`);

const startAll = Date.now();
let completed = 0;
let maxCode = 0;
let totalPass = 0;
let totalFail = 0;
const failures: JobResult[] = [];

for await (const r of runPool(files, concurrency)) {
  completed++;
  const rel = r.file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const stat = r.code === 0 ? "ok" : `FAIL(${r.code})`;
  const { pass, fail } = parsePassFail(r.stdout + r.stderr);
  totalPass += pass;
  totalFail += fail;
  const secs = (r.durationMs / 1000).toFixed(1);
  console.error(`  [${completed}/${files.length}] ${stat}  ${rel}  (${pass} pass, ${fail} fail, ${secs}s)`);
  if (r.code !== 0) {
    failures.push(r);
    maxCode = Math.max(maxCode, r.code);
  }
}

const elapsed = ((Date.now() - startAll) / 1000).toFixed(1);
console.error(`\n[test-parallel] ${totalPass} pass, ${totalFail} fail, elapsed ${elapsed}s`);

if (failures.length > 0) {
  console.error(`\n[test-parallel] ${failures.length} file(s) failed, output follows:\n`);
  for (const f of failures) {
    const rel = f.file.slice(ROOT.length + 1).replace(/\\/g, "/");
    console.error(`\n===== ${rel} (exit ${f.code}) =====`);
    console.error(f.stdout);
    if (f.stderr) console.error(f.stderr);
  }
}

process.exit(maxCode);

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Pulls `bun test`'s summary line (format: ` 952 pass\n 0 fail`). Checks
 * both stdout and stderr since the split differs by platform.
 */
function parsePassFail(text: string): { pass: number; fail: number } {
  const pass = /(\d+)\s+pass\b/.exec(text);
  const fail = /(\d+)\s+fail\b/.exec(text);
  return {
    pass: pass ? Number(pass[1]) : 0,
    fail: fail ? Number(fail[1]) : 0,
  };
}
