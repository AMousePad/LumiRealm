import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

afterEach(async () => { for (const mode of ['editInput', 'input']) await clearWasmoonEngine(mode); });

const order = (f: ReturnType<typeof frontendRuntime>) => f.state.hostMessages().map(message => message.content);
const stored = (f: ReturnType<typeof frontendRuntime>) => [...f.dto.messages].sort((a, b) => a.index_in_chat - b.index_in_chat).map(message => message.content);

test('a mid-chat insert keeps its place after the write settles', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editInput',function(id,text) insertChat(id,1,'user','Inserted');return text end)");
  expect(order(f)).toEqual(stored(f));
  expect(f.state.messages.map(message => message.content)).toEqual(['Hello', 'Inserted', 'Welcome']);
});

test('the run after an insert addresses the row the host has at that index', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editInput',function(id,text) insertChat(id,1,'user','Inserted');return text end)");
  await f.run("listenEdit('editInput',function(id,text) setChat(id,2,'Edited');return text end)");
  expect(f.state.messages.map(message => message.content)).toEqual(['Hello', 'Inserted', 'Edited']);
  expect(stored(f).at(-1)).toBe('Edited');
});

test('two inserts in one run land in place', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editInput',function(id,text) insertChat(id,1,'user','One');insertChat(id,2,'user','Two');return text end)");
  expect(f.state.messages.map(message => message.content)).toEqual(['Hello', 'One', 'Two', 'Welcome']);
  expect(order(f)).toEqual(stored(f));
});

test('an insert from outside this run shifts the rows after it', () => {
  const f = frontendRuntime();
  const anchor = f.dto.messages.find(message => message.content === 'Welcome')!;
  const index = anchor.index_in_chat;
  for (const row of f.dto.messages.filter(row => row.index_in_chat >= index)) row.index_in_chat++;
  const message = { ...anchor, id: 'outside', content: 'Outside', index_in_chat: index };
  f.dto.messages.push(message);
  f.event({ message });
  f.event({ message });
  expect(order(f)).toEqual(stored(f));
  expect(f.state.messages.map(row => row.content)).toEqual(['Hello', 'Outside', 'Welcome']);
});

test('a plain append moves nothing', async () => {
  const f = frontendRuntime();
  const before = f.dto.messages.map(message => message.index_in_chat);
  await f.run("listenEdit('editInput',function(id,text) addChat(id,'char','Tail');return text end)");
  expect(f.dto.messages.slice(0, before.length).map(message => message.index_in_chat)).toEqual(before);
  expect(order(f)).toEqual(stored(f));
});
