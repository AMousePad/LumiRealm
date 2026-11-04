import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

afterEach(async () => { for (const mode of ['editInput', 'input']) await clearWasmoonEngine(mode); });

test('role edits preserve source times and row identities immediately, after acknowledgement and reload', async () => {
  const f = frontendRuntime();
  expect(await f.run("listenEdit('editInput',function(id,text) setChatRole(id,0,'char');return getChat(id,0).time..'|'..getChat(id,1).time end)"))
    .toBe('1700000000000|1700000005000');
  expect(f.writes.map(command => command.kind)).toEqual(['message.edit']);
  expect(f.dto.messages.map(message => message.id)).toEqual(['greeting', 'user', 'reply']);
  const reloaded = frontendRuntime(f.dto);
  expect(await reloaded.run("listenEdit('editInput',function(id,text) return getChat(id,0).role..'|'..getChat(id,0).time end)"))
    .toBe('char|1700000000000');
});

test.each([0, 1, 2, -1])('insertion at %s preserves existing times and uses one host write', async index => {
  const f = frontendRuntime();
  const at = index < 0 ? 1 : index;
  expect(await f.run(`listenEdit('editInput',function(id,text) insertChat(id,${index},'user','Inserted');return getChat(id,${at}).data..'|'..getChat(id,${at}).time end)`))
    .toBe('Inserted|0');
  expect(f.writes.map(command => command.kind)).toEqual(['message.create']);
  const expected = ['Hello', 'Welcome']; expected.splice(at, 0, 'Inserted');
  expect(f.state.messages.map(message => message.content)).toEqual(expected);
  expect(f.state.messages.find(message => message.id === 'user')?.createdAt).toBe(1700000000000);
  expect(f.state.messages.find(message => message.id === 'reply')?.createdAt).toBe(1700000005000);
  const reloaded = frontendRuntime(f.dto);
  expect(await reloaded.run(`listenEdit('editInput',function(id,text) return getChat(id,${at}).time end)`)).toBe(0);
});

test('end insertion stays before trailing assistant placeholders', async () => {
  const seed = frontendRuntime().dto;
  seed.messages.push({ id: 'placeholder', role: 'assistant', content: '', index_in_chat: 3, send_date: 1900000000 });
  const f = frontendRuntime(seed);
  expect(await f.run("listenEdit('editInput',function(id,text) insertChat(id,getChatLength(id),'user','Inserted');return getChatLength(id)..'|'..getChat(id,-1).data end)"))
    .toBe('3|Inserted');
  expect(f.state.messages.map(message => message.content)).toEqual(['Hello', 'Welcome', 'Inserted']);
  expect(f.dto.messages.at(-1)?.id).toBe('placeholder');
});

function greetingOnly() {
  const seed = frontendRuntime().dto;
  seed.messages = seed.messages.slice(0, 1);
  return frontendRuntime(seed);
}

test('an empty row a script adds stays addressable, like Risu chat.message', async () => {
  const f = greetingOnly();
  expect(await f.run("listenEdit('editInput',function(id,text) addChat(id,'char','');local n=getChatLength(id);setChat(id,0,'Scene');return n..'|'..getChatLength(id)..'|'..getChat(id,0).data end)"))
    .toBe('1|1|Scene');
  expect(f.writes.map(command => command.kind)).toEqual(['message.create', 'message.edit']);
  expect(f.dto.messages.map(message => message.content)).toEqual(['Greeting', 'Scene']);
  expect(f.state.messages.map(message => message.content)).toEqual(['Scene']);
});

test('a row a script leaves empty stays counted across later runs', async () => {
  const f = greetingOnly();
  await f.run("listenEdit('editInput',function(id,text) addChat(id,'char','');return text end)");
  expect(await f.run("listenEdit('editInput',function(id,text) return getChatLength(id) end)")).toBe(1);
  expect(f.state.messages.map(message => message.content)).toEqual(['']);
});

test('a script clearing the last reply keeps the row, like Risu setChat', async () => {
  const f = frontendRuntime();
  expect(await f.run("listenEdit('editInput',function(id,text) setChat(id,-1,'');return getChatLength(id)..'|'..getChat(id,-1).data end)"))
    .toBe('2|');
  expect(f.state.messages.map(message => message.content)).toEqual(['Hello', '']);
});

test('ordinary trigger adoption also preserves roles and insertion order', async () => {
  const f = frontendRuntime();
  await f.run("function onInput(id) setChatRole(id,0,'char');insertChat(id,1,'user','Inserted') end", { kind: 'binding', binding: 'input' });
  expect(f.state.messages.map(message => [message.content, message.role, message.createdAt])).toEqual([
    ['Hello', 'assistant', 1700000000000], ['Inserted', 'user', 0], ['Welcome', 'assistant', 1700000005000],
  ]);
  expect(f.writes.map(command => command.kind)).toEqual(['message.edit', 'message.create']);
});
