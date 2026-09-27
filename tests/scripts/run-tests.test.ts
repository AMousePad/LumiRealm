import { expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the suite runner executes selected files without matching backup copies', () => {
  const root = mkdtempSync(join(tmpdir(), 'suite-paths-'));
  try {
    for (const path of ['scripts', 'tests', 'local/tests', 'backup/tests']) {
      mkdirSync(join(root, path), { recursive: true });
    }
    copyFileSync(new URL('../../scripts/run-tests.ts', import.meta.url), join(root, 'scripts/run-tests.ts'));
    writeFileSync(join(root, 'tests/example.test.ts'), "import {test} from 'bun:test'; test('selected public case', () => {});");
    writeFileSync(join(root, 'local/tests/private.test.ts'), "import {test} from 'bun:test'; test('selected local case', () => {});");
    writeFileSync(join(root, 'backup/tests/example.test.ts'), "throw new Error('Backup must not execute');");
    writeFileSync(join(root, 'tests/omitted.slow.test.ts'), "throw new Error('Slow test must not execute');");
    const result = Bun.spawnSync([process.execPath, 'scripts/run-tests.ts', '--fast'], { cwd: root });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).toContain('selected public case');
    expect(output).toContain('selected local case');
    expect(output).not.toContain('Backup must not execute');
    expect(output).not.toContain('Slow test must not execute');
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
