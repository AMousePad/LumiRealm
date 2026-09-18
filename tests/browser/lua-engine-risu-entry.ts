import { LuaFactory } from 'wasmoon';
import { GLUE_WASM_DATA_URI } from '../../src/display/_glue-wasm-b64';
import { executeWasmoon } from '../../src/interpreter/lua-wasmoon';
import { execute } from '../../src/interpreter/lua-bridge';
import jsonLuaSource from '../../src/interpreter/lua-json.lua' with { type: 'text' };
import { engineCases, engineGlobals } from './lua-engine-risu-cases';
import { risuPrelude } from './lua-engine-risu-oracle';

async function run() {
  const factory = new LuaFactory(GLUE_WASM_DATA_URI);
  await factory.mountFile('json.lua', jsonLuaSource);
  const results = [];
  for (const fixture of engineCases) {
    const row: Record<string, unknown> = { name: fixture.name };
    for (const kind of ['risu', 'wasmoon', 'fengari'] as const) {
      const globals = engineGlobals(kind === 'risu');
      const oracle = kind === 'risu' ? await factory.createEngine({ injectObjects: true }) : undefined;
      const values: unknown[] = [];
      try {
        if (oracle) {
          for (const [name, value] of Object.entries(globals)) oracle.global.set(name, value);
          await oracle.doString(risuPrelude + '\n' + fixture.code);
        }
        for (const _ of fixture.expected) {
          values.push(oracle
            ? await oracle.global.get('probe')('safe')
            : kind === 'wasmoon'
              ? await executeWasmoon(fixture.code, globals, { entry: 'probe', args: ['safe'], wasmoonKey: fixture.name })
              : await execute(fixture.code, globals, { entry: 'probe', args: ['safe'] }));
        }
        row[kind] = { values };
      } catch (error) {
        row[kind] = { values, error: String(error) };
      } finally {
        oracle?.global.close();
      }
    }
    results.push(row);
  }
  return results;
}

Object.assign(globalThis, { engineResults: run() });
