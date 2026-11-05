import { expect, test } from 'bun:test';
import type { HostMessage } from '../../src/interpreter/host.js';
import { hostLuaMessageData, hostLuaOwnMetadata, luaMessageData, luaMessageEdit, luaMessageFields, luaOwnMetadata, luaPlainTextEditOptions } from '../../src/util/lua-message-data.js';
import { hostMessageTime } from '../../src/util/message-time.js';

const row = (value: unknown, extra: Partial<HostMessage> = {}): HostMessage => ({ id: 'row', role: 'user', createdAt: 5, ...luaMessageFields(value), ...extra });
const stored = (message: HostMessage, options: Parameters<typeof luaOwnMetadata>[0]) => ({ content: message.content, ...luaOwnMetadata(options) });

test('stored data reads back only while the text it was written for is current', () => {
  const message = row(42);
  const host = stored(message, { luaData: message.luaData! });
  expect(hostLuaMessageData(host)?.value).toBe(42);
  expect(hostLuaMessageData({ ...host, content: '43' })).toBeNull();
  expect(hostLuaMessageData({ ...host, content: '42 ' })).toBeNull();
});

test('a data edit keeps the stored time and a time edit keeps the stored data', () => {
  const dataEdit = luaMessageEdit(row('text'), row(42))!;
  expect(dataEdit.content).toBe('42');
  expect(luaOwnMetadata(dataEdit.options)).toEqual({ ownMetadata: { luaMessageTime: 5, luaData: row(42).luaData } });
  const timeEdit = luaMessageEdit(row(42), row(42, { createdAt: 9 }))!;
  expect(timeEdit.content).toBeUndefined();
  expect(luaOwnMetadata(timeEdit.options)).toEqual({ ownMetadata: { luaMessageTime: 9, luaData: row(42).luaData } });
});

test('a same-text string write clears stored data', () => {
  const edit = luaMessageEdit(row(42), row('42'))!;
  expect(edit.content).toBe('42');
  expect(luaOwnMetadata(edit.options)).toEqual({ ownMetadata: { luaMessageTime: 5 } });
  expect(luaOwnMetadata(luaPlainTextEditOptions(row(42)))).toEqual({ ownMetadata: { luaMessageTime: 5 } });
  expect(luaPlainTextEditOptions(row('42'))).toBeUndefined();
});

test('plain text and role edits leave stored values out of the write', () => {
  expect(luaMessageEdit(row('a'), row('b'))).toEqual({ content: 'b', options: {} });
  expect(luaMessageEdit(row(42), row(42, { role: 'assistant' }))).toEqual({ content: undefined, options: { role: 'assistant' } });
  expect(luaMessageEdit(row(42), row(42))).toBeNull();
});

test('time and data read through every host message shape', () => {
  const own = luaOwnMetadata({ createdAt: 7, luaData: row(42).luaData! }).ownMetadata;
  for (const shape of [{ ownMetadata: own }, { metadata: { lumirealm: own } }, { extra: { spindle_metadata: { lumirealm: own } } }]) {
    expect(hostMessageTime(shape)).toBe(7);
    expect(luaMessageData({ content: '42', luaData: hostLuaMessageData({ content: '42', ...shape }) })).toBe(42);
  }
  expect(hostLuaOwnMetadata({ ownMetadata: { luaMessageTime: 'bad', luaData: [] } })).toEqual({});
});
