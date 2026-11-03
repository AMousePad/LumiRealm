import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

afterEach(async () => { for (const mode of ['editInput', 'input', 'editDisplay']) await clearWasmoonEngine(mode); });

const readers = "type(getChat(id,0).data)..'|'..type(getChatData(id,0))..'|'..type(getFullChat(id)[1].data)..'|'..type(getRecentChats(id,99)[1].data)";
test('ordinary string edits publish once across the native acknowledgement', async () => {
  const f = frontendRuntime(), before = f.notifications();
  await f.run("listenEdit('editInput',function(id,text) setChat(id,0,'Edited');return text end)");
  expect(f.notifications() - before).toBe(1);
  expect(f.writes).toHaveLength(1);
});

for (const [value, kind] of [['42', 'number'], ['0', 'number'], ['false', 'boolean'], ['true', 'boolean'], ['nil', 'string']] as const) {
  for (const setter of [`setChat(id,0,${value})`, `insertChat(id,0,'user',${value})`, `cutChat(id,0,0);addChat(id,'user',${value})`]) {
    test(`${setter} retains data types through acknowledgement and reload`, async () => {
      const f = frontendRuntime(), expected = Array(4).fill(kind).join('|');
      expect(await f.run(`listenEdit('editInput',function(id,text) ${setter};return ${readers} end)`)).toBe(expected);
      const reloaded = frontendRuntime(f.dto);
      expect(await reloaded.run(`listenEdit('editInput',function(id,text) return ${readers} end)`)).toBe(expected);
    });
  }
}

test('copied trigger adoption persists scalar data and same-text string writes clear it', async () => {
  const f = frontendRuntime();
  await f.run('function onInput(id) setChat(id,0,42) end', { kind: 'binding', binding: 'input' });
  expect(await f.run(`listenEdit('editInput',function(id,text) return ${readers} end)`)).toBe('number|number|number|number');
  await f.run("listenEdit('editInput',function(id,text) setChat(id,0,'42');return text end)");
  expect(await frontendRuntime(f.dto).run(`listenEdit('editInput',function(id,text) return ${readers} end)`)).toBe('string|string|string|string');
  expect(f.dto.messages[1]?.content).toBe('42');
});

test.each(['{"role":"user"}', '{"role":"user","data":null}', '{"role":"user","data":false}'])('full replacement preserves missing/null/scalar data: %s', async row => {
  const f = frontendRuntime();
  const json = `[${row}]`;
  const expected = row.includes('false') ? '[{"role":"user","data":false,"time":0}]'
    : row.includes('null') ? '[{"role":"user","data":null,"time":0}]' : '[{"role":"user","time":0}]';
  expect(await f.run(`listenEdit('editInput',function(id,text) setFullChatMain(id,'${json}');return getFullChatMain(id) end)`)).toBe(expected);
  expect(await frontendRuntime(f.dto).run("listenEdit('editInput',function(id,text) return getFullChatMain(id) end)")).toBe(expected);
});

test('native same-text edit replaces raw data and role/time edits preserve it', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editInput',function(id,text) setChat(id,0,42);setChatRole(id,0,'char');return text end)");
  expect(await f.run(`listenEdit('editInput',function(id,text) return ${readers} end)`)).toBe('number|number|number|number');
  const message = f.dto.messages[1]!;
  delete message.extra!.spindle_content_metadata;
  f.event({ message });
  expect(await f.run(`listenEdit('editInput',function(id,text) return ${readers} end)`)).toBe('string|string|string|string');
});
