import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

afterEach(async () => { for (const mode of ['editInput', 'input']) await clearWasmoonEngine(mode); });

test.each(['edit', 'binding'])('full replacement clears timestamps through %s and reload without rewriting unchanged content', async mode => {
  const f = frontendRuntime();
  const body = "local rows=getFullChat(id);rows[1].time=999;setFullChat(id,rows)";
  if (mode === 'edit') {
    expect(await f.run(`listenEdit('editInput',function(id,text) ${body};return getChat(id,0).time..'|'..getChat(id,1).time end)`)).toBe('0|0');
  } else await f.run(`function onInput(id) ${body} end`, { kind: 'binding', binding: 'input' });
  expect(f.state.messages.map(message => message.createdAt)).toEqual([0, 0]);
  expect(f.dto.messages.map(message => message.id)).toEqual(['greeting', 'user', 'reply']);
  expect(f.writes).toEqual(['user', 'reply'].map(id => ({ kind: 'message.edit', id, ownMetadata: { luaMessageTime: 0 } })));
  const reloaded = frontendRuntime(f.dto);
  expect(await reloaded.run("listenEdit('editInput',function(id,text) setFullChat(id,getFullChat(id));return getChat(id,0).time..'|'..getChat(id,1).time end)")).toBe('0|0');
  expect(reloaded.writes).toEqual([]);
});

test('replacement clears time while changing content and creating rows', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editInput',function(id,text) setFullChat(id,{{role='user',data='Changed'},{role='char',data='Welcome'},{role='user',data='New'}});return text end)");
  expect(f.state.messages.map(message => [message.content, message.createdAt])).toEqual([['Changed', 0], ['Welcome', 0], ['New', 0]]);
});
