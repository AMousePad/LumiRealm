import { mock } from 'bun:test';
import { dirname, join } from 'node:path';

// Bun's native Wasmoon loader needs a file path; browser tests use the production data URI.
mock.module('../../src/display/_glue-wasm-b64.js', () => ({
  GLUE_WASM_DATA_URI: join(dirname(Bun.resolveSync('wasmoon', import.meta.dir)), 'glue.wasm'),
}));
