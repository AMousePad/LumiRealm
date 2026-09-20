import { LuaFactory } from 'wasmoon';
import json from './lua-json.lua' with { type: 'text' };
import { createLuaExecutor } from './lua-engine.js';

let factory: Promise<LuaFactory> | undefined;
const executor = createLuaExecutor(() => factory ??= (async () => {
  const value = new LuaFactory();
  await value.mountFile('json.lua', json);
  return value;
})().catch(cause => { factory = undefined; throw cause; }));

export type { ExecuteOpts } from './lua-engine.js';
export const execute = executor.execute;
export const clearLuaEngines = executor.clear;
