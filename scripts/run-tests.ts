// Test runner that splits the suite into fast vs slow.
//
// Slow tests are the ones whose filename ends in `.slow.test.ts`, typically
// full-corpus walks (translate every card in the optional library at
// `tests/local_library/`, validate every emitted SVG, parse every emitted
// script, etc). They take ~10-20 minutes wall-clock, so running them
// iteratively wastes session time.
//
// Usage:
//   bun scripts/run-tests.ts --fast       # all *.test.ts EXCLUDING *.slow.test.ts
//   bun scripts/run-tests.ts --slow       # all *.slow.test.ts
//   bun scripts/run-tests.ts --all        # everything
//
// Wired into package.json scripts (`test`, `test:fast`, `test:slow`).

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..");
const TESTS_ROOT = join(REPO_ROOT, "tests");
// Optional private overlay: machine-specific card regressions, absent on clones.
const LOCAL_TESTS_ROOT = join(REPO_ROOT, "local", "tests");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "--fast" && mode !== "--slow" && mode !== "--all") {
    process.stderr.write(
      "Usage: bun scripts/run-tests.ts --fast | --slow | --all\n",
    );
    process.exit(2);
  }

  const all = walk(TESTS_ROOT);
  if (existsSync(LOCAL_TESTS_ROOT)) walk(LOCAL_TESTS_ROOT, all);
  const filtered = mode === "--all"
    ? all
    : mode === "--slow"
      ? all.filter((p) => p.endsWith(".slow.test.ts"))
      : all.filter((p) => !p.endsWith(".slow.test.ts"));

  if (filtered.length === 0) {
    process.stderr.write(`run-tests: no tests matched ${mode}\n`);
    process.exit(0);
  }

  const rels = filtered.map((p) => relative(REPO_ROOT, p));
  process.stdout.write(`run-tests ${mode}: ${rels.length} files\n`);

  const child = spawn("bun", ["test", ...rels], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    process.stderr.write(`run-tests: spawn failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}

main();
