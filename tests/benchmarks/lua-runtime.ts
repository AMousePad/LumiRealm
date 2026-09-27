import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { LuaFactory } from 'wasmoon';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge.js';

// Run with BASELINE_DIR and RISUAI_DIR pointing at the comparison checkouts.
const baselineDir = process.env.BASELINE_DIR;
const risuDir = process.env.RISUAI_DIR;
if (!baselineDir || !risuDir) throw new Error('Set BASELINE_DIR and RISUAI_DIR');
const baseline = await import(pathToFileURL(resolve(baselineDir, 'src/interpreter/lua-bridge.ts')).href);
const source = await Bun.file(join(risuDir, 'src/ts/process/scriptings.ts')).text();
const from = source.indexOf('function luaCodeWrapper(code:string)');
const to = source.indexOf('export async function runLuaEditTrigger', from);
if (from < 0 || to < 0) throw new Error('Risu wrapper boundaries changed');
const wrapper = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(from, to)) + ';return luaCodeWrapper;')() as (code: string) => string;
const factory = new LuaFactory();
await factory.mountFile('json.lua', await Bun.file(join(risuDir, 'public/lua/json.lua')).text());
const request = [{ role: 'system', content: 'a'.repeat(475685) }, { role: 'assistant', content: 'b'.repeat(45099) }, { role: 'system', content: 'c'.repeat(13789) }, { role: 'user', content: 'd'.repeat(218) }];
request[0]!.content += 'a'.repeat(543211 - JSON.stringify(request).length);
const codes = Array.from({ length: 16 }, (_, index) => `local index = ${index}; listenEdit('editDisplay', function(id, text) return text end)`);
const samples: Record<string, number[]> = { baseline: [], migrated: [], risu: [] };
for (let round = -1; round < 3; round++) {
  for (const kind of round % 2 ? ['baseline', 'migrated', 'risu'] : ['risu', 'migrated', 'baseline']) {
    await clearLuaEngines();
    let engine: Awaited<ReturnType<LuaFactory['createEngine']>> | undefined;
    let value = request;
    const start = performance.now();
    try {
      for (const code of codes) {
        const args = ['editRequest', 'benchmark', JSON.stringify(value), '{}'];
        let result: unknown;
        if (kind === 'risu') {
          engine?.global.close(); engine = await factory.createEngine({ injectObjects: true });
          await engine.doString(wrapper(code));
          result = await engine.global.get('callListenMain')(...args);
        } else result = await (kind === 'baseline' ? baseline.execute : execute)(code, {}, { entry: 'callListenMain', args });
        value = JSON.parse(result as string);
      }
    } finally { engine?.global.close(); }
    const ms = performance.now() - start;
    assert.deepEqual(value, request);
    if (round >= 0) samples[kind]!.push(ms);
    console.log(JSON.stringify({ round, kind, ms }));
  }
}
console.log(JSON.stringify({ requestChars: JSON.stringify(request).length, chunks: codes.length, samples,
  medians: Object.fromEntries(Object.entries(samples).map(([kind, values]) => [kind, [...values].sort((a, b) => a - b)[1]])),
  outputsMatch: true,
}, null, 2));
