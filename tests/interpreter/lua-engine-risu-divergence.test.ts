import { describe, expect, test } from 'bun:test';
import { execute } from '../../src/interpreter/lua-bridge';
import { engineCases, engineGlobals } from '../browser/lua-engine-risu-cases';

describe('Embedded Wasmoon parity with Risu runScripted and luaCodeWrapper', () => {
  for (const fixture of engineCases) {
    test(fixture.name, async () => {
      const globals = engineGlobals(true);
      const actual: unknown[] = [];
      for (const _ of fixture.expected) {
        actual.push(await execute(fixture.code, globals, { entry: 'probe', args: ['safe'] }));
      }
      expect(actual).toEqual([...fixture.expected]);
    });
  }
});
