import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkParserMacros, classify } from '../../tools/audit-handler-parity.js';

const risuMacro = (name: string) => ({ name, aliases: [], body: "callback: () => 'implemented'", startLine: 1, endLine: 1 });
const emptyHandler = (name: string) => ({ name, body: `register("${name}", () => "", "description");`, filePath: 'handlers.ts', startLine: 1 });

describe('handler parity audit', () => {
  test('checks scanner effects and declaration literal preservation through the real parser', () => {
    const checks = checkParserMacros();
    expect([...checks.keys()]).toEqual(['bkspc', 'erase', 'declare']);
    for (const check of checks.values()) expect(check.passed).toBe(true);
    for (const name of ['bkspc', 'erase']) {
      expect(classify(emptyHandler(name), risuMacro(name), checks).tier).toBe('OK');
    }
    expect(checks.get('declare')!.reason).toContain('supplied declaration maps are outside this check');
  });

  test('a removed scanner effect is not exempted merely by macro name', () => {
    const checks = checkParserMacros(template => template);
    for (const name of ['bkspc', 'erase']) {
      expect(checks.get(name)!.passed).toBe(false);
      expect(classify(emptyHandler(name), risuMacro(name), checks).tier).toBe('STUB');
    }
  });

  test('empty declaration stubs and throwing parser paths fail the behavior checks', () => {
    expect(checkParserMacros(() => '').get('declare')!.passed).toBe(false);
    const checks = checkParserMacros(() => { throw new Error('parser failed'); });
    for (const check of checks.values()) {
      expect(check.passed).toBe(false);
      expect(check.reason).toContain('parser failed');
    }
  });

  test('unrelated literal stubs remain errors', () => {
    expect(classify(emptyHandler('unimplemented'), risuMacro('unimplemented'), checkParserMacros()).tier).toBe('STUB');
  });

  test('CLI reports parser coverage and fails for a genuinely missing macro', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumirealm-audit-'));
    const srcDir = join(dir, 'src');
    const tsDir = join(srcDir, 'ts');
    const file = join(tsDir, 'cbs.ts');
    mkdirSync(srcDir); mkdirSync(tsDir);
    const source = (names: string[]) => names.map(name => `registerFunction({
  name: '${name}',
  callback: () => { return '${name === 'blank' || name === 'hiddenkey' ? '' : 'implemented'}' },
  alias: [],
})`).join('\n');
    const root = resolve(import.meta.dir, '../..');
    const run = () => Bun.spawnSync([process.execPath, join(root, 'tools/audit-handler-parity.ts')], {
      cwd: root, env: { ...process.env, RISUAI_DIR: dir }, stdout: 'pipe', stderr: 'pipe',
    });
    try {
      writeFileSync(file, source(['bkspc', 'erase', 'declare', 'blank', 'hiddenkey']));
      const pass = run();
      expect(pass.exitCode, pass.stdout.toString() + pass.stderr.toString()).toBe(0);
      expect(pass.stdout.toString()).toContain('STUBS: 0');
      expect(pass.stdout.toString()).toContain('Missing from ours: 0');
      expect(pass.stdout.toString()).toContain('declare: PASS: literal preservation');
      writeFileSync(file, source(['bkspc', 'erase', 'declare', 'blank', 'hiddenkey', 'unimplemented_audit_fixture']));
      const fail = run();
      expect(fail.exitCode).toBe(1);
      expect(fail.stdout.toString()).toContain('Missing from ours: 1');
      expect(fail.stdout.toString()).toContain('- unimplemented_audit_fixture');
    } finally {
      unlinkSync(file); rmdirSync(tsDir); rmdirSync(srcDir); rmdirSync(dir);
    }
  });
});
