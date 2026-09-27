import type { LuaFactory } from 'wasmoon';
import json from './lua-json.lua' with { type: 'text' };
import { createLuaExecutor, type ExecuteOpts } from './lua-engine.js';

let factory: Promise<LuaFactory> | undefined;
const executor = createLuaExecutor(() => factory ??= (async () => {
  const [mod, glue] = await Promise.all([
    import('wasmoon'), import('../display/_glue-wasm-b64.js'),
  ]);
  const value = new mod.LuaFactory(glue.GLUE_WASM_DATA_URI);
  await value.mountFile('json.lua', json);
  return value;
})().catch(cause => { factory = undefined; throw cause; }));

export interface WasmoonExecuteOpts extends ExecuteOpts {
  readonly wasmoonKey: string;
}

export const clearWasmoonEngine = (mode: string): Promise<void> => executor.clear('', mode);
export const executeWasmoon = (code: string, globals: Record<string, unknown>, opts: WasmoonExecuteOpts): Promise<unknown> =>
  executor.execute(code, globals, { ...opts, mode: opts.mode ?? opts.wasmoonKey });
