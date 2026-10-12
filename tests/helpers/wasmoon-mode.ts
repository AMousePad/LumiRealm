import { setWasmoonExecutor } from '../../src/interpreter/runtime.js';
import { executeWasmoon } from '../../src/interpreter/lua-wasmoon.js';

export function setWasmoonEnabled(enabled: boolean): void {
  setWasmoonExecutor(enabled ? executeWasmoon : null);
}
