import { expect, test } from 'bun:test';
import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import type { RuntimeStateDto, RuntimeStateWrite } from '../../src/frontend-lua/state-contract.js';

const revision = (sequence: number) => ({ epoch: 'host', sequence });
function initial(): RuntimeStateDto {
  return { revision: revision(1), chat: { id: 'chat', metadata: { chat_variables: { panel: 'closed' } } },
    character: { id: 'character', name: 'Character' }, persona: null,
    messages: [{ id: 'greeting', content: 'hello', role: 'assistant', index_in_chat: 0 },
      { id: 'user', content: 'before', role: 'user', index_in_chat: 1 }], lore: [], globalVariables: {} };
}

test('queued synchronous Lua mutations stay visible while earlier message writes complete', async () => {
  const replies: ((reply: RuntimeStateWrite) => void)[] = [];
  const state = new FrontendRuntimeState(initial(), () => new Promise(resolve => replies.push(resolve)), () => {});
  const chat = state.luaChat();
  state.messages[0] = { ...state.messages[0]!, content: 'first' };
  const first = chat.enqueue!(async () => { await state.write({ kind: 'message.edit', id: 'user', content: 'first' }, false); });
  state.messages[0] = { ...state.messages[0]!, content: 'second' };
  const second = chat.enqueue!(async () => { await state.write({ kind: 'message.edit', id: 'user', content: 'second' }, false); });
  await Promise.resolve();
  expect(state.messages[0]!.content).toBe('second');
  replies[0]!({ revision: revision(2), value: undefined, patch: { message: { ...initial().messages[1]!, content: 'first' } } });
  await first;
  expect(state.messages[0]!.content).toBe('second');
  await Promise.resolve();
  replies[1]!({ revision: revision(3), value: undefined, patch: { message: { ...initial().messages[1]!, content: 'second' } } });
  await second;
  expect(state.messages[0]!.content).toBe('second');
});

test('host updates mutate the live array and leave the greeting out of Lua indexes', () => {
  const state = new FrontendRuntimeState(initial(), async () => { throw new Error('Unexpected write'); }, () => {});
  const live = state.luaChat().messages;
  state.apply(revision(2), { message: { ...initial().messages[1]!, content: 'external edit' } });
  expect(state.luaChat().messages).toBe(live);
  expect(live.map(message => message.content)).toEqual(['external edit']);
  expect(state.hostMessages().map(message => message.content)).toEqual(['hello', 'external edit']);
});

test('write echoes and stale snapshots cannot restore previous variables', async () => {
  let acknowledge!: (value: RuntimeStateWrite) => void;
  const state = new FrontendRuntimeState(initial(), () => new Promise(resolve => { acknowledge = resolve; }), () => {});
  const write = state.write({ kind: 'chat.variables', values: { panel: 'open' } });
  state.replace(initial());
  expect(state.variable('panel')).toBe('open');
  acknowledge({ revision: revision(2), value: undefined, patch: { chat: { id: 'chat', metadata: { chat_variables: { panel: 'open' } } } } });
  await write;
  state.replace(initial());
  expect(state.variable('panel')).toBe('open');
});

test('serialized commit echoes preserve structured metadata without another state notification', async () => {
  const data = initial();
  data.chat.metadata.preferences = { selected: ['first', 'second'], enabled: true };
  const changes: string[][] = [];
  let acknowledge!: (value: RuntimeStateWrite) => void;
  let mutationId!: string;
  const state = new FrontendRuntimeState(data, (_command, id) => {
    mutationId = id;
    return new Promise(resolve => { acknowledge = resolve; });
  }, keys => changes.push([...keys]));
  changes.length = 0;
  state.stageVariables({ panel: 'open' });
  const write = state.flush();
  expect(changes).toEqual([['["vars","","panel"]']]);
  changes.length = 0;
  const patch = { chat: structuredClone(data.chat) };
  patch.chat.metadata.chat_variables = { panel: 'open' };
  state.apply(revision(2), structuredClone(patch), mutationId);
  acknowledge({ revision: revision(2), value: undefined, patch: structuredClone(patch) });
  await write;
  expect(changes).toEqual([]);
  state.apply(revision(3), { chat: { ...patch.chat, metadata: {
    ...patch.chat.metadata, preferences: { enabled: true, selected: ['first', 'second'] },
  } } });
  expect(changes).toEqual([]);
  state.apply(revision(4), { chat: { ...patch.chat, metadata: {
    ...patch.chat.metadata, preferences: { enabled: true, selected: ['second', 'first'] },
  } } });
  expect(changes).toEqual([['["metadata","","preferences"]']]);
  expect(state.metadata('preferences')).toEqual({ enabled: true, selected: ['second', 'first'] });
});

test('persistence failures remain visible even if a compatibility helper catches its rejection', async () => {
  const state = new FrontendRuntimeState(initial(), async () => { throw new Error('Write rejected'); }, () => {});
  await state.write({ kind: 'chat.variables', values: { panel: 'open' } }).catch(() => {});
  expect(state.variable('panel')).toBe('closed');
  await expect(state.flush()).rejects.toThrow('Frontend Lua persistence failed');
});

test('an external variable edit after the committed event is visible before a delayed acknowledgement', async () => {
  let acknowledge!: (value: RuntimeStateWrite) => void;
  let mutationId!: string;
  const state = new FrontendRuntimeState(initial(), (_command, id) => { mutationId = id; return new Promise(resolve => { acknowledge = resolve; }); }, () => {});
  state.stageVariables({ panel: 'local' });
  const flush = state.flush();
  const patch = { chat: { id: 'chat', metadata: { chat_variables: { panel: 'local' } } } };
  state.apply(revision(2), patch, mutationId);
  state.apply(revision(3), { chat: { id: 'chat', metadata: { chat_variables: { panel: 'external' } } } });
  expect(state.variable('panel')).toBe('external');
  acknowledge({ revision: revision(2), value: undefined, patch });
  await flush;
  expect(state.variable('panel')).toBe('external');
});

test('a committed queued message edit exposes later native changes before its acknowledgement', async () => {
  let acknowledge!: (value: RuntimeStateWrite) => void;
  let mutationId!: string;
  const state = new FrontendRuntimeState(initial(), (_command, id) => { mutationId = id; return new Promise(resolve => { acknowledge = resolve; }); }, () => {});
  const chat = state.luaChat();
  state.messages[0] = { ...state.messages[0]!, content: 'local' };
  const write = chat.enqueue!(async () => { await state.write({ kind: 'message.edit', id: 'user', content: 'local' }, false); });
  await Promise.resolve();
  const patch = { message: { ...initial().messages[1]!, content: 'local' } };
  state.apply(revision(2), patch, mutationId);
  state.apply(revision(3), { message: { ...initial().messages[1]!, content: 'external' } });
  expect(state.messages[0]!.content).toBe('external');
  acknowledge({ revision: revision(2), value: undefined, patch });
  await write;
  expect(state.messages[0]!.content).toBe('external');
});

test('a display view follows native edits without publishing its raw render argument', () => {
  const state = new FrontendRuntimeState(initial(), async () => { throw new Error('Unexpected write'); }, () => {});
  const initialRows = state.hostMessages().map(message => ({ ...message, content: message.id === 'user' ? 'render input' : message.content }));
  const display = state.displayChat(initialRows, undefined);
  expect(display.chat.messages[0]!.content).toBe('render input');
  expect(state.messages[0]!.content).toBe('before');
  state.apply(revision(2), { message: { ...initial().messages[1]!, content: 'native edit' } });
  expect(display.chat.messages[0]!.content).toBe('native edit');
  display.release();
});

test('chat globals share ordered metadata updates, including deletion and stale acknowledgements', async () => {
  const data = initial();
  data.chat.metadata.macro_variables = { global: { toggle_mode: '0', removed: 'old' } };
  data.globalVariables = { toggle_mode: 'account' };
  let acknowledge!: (reply: RuntimeStateWrite) => void;
  let mutationId!: string;
  const changes: string[][] = [];
  const state = new FrontendRuntimeState(data, (_command, id) => {
    mutationId = id;
    return new Promise(resolve => { acknowledge = resolve; });
  }, keys => changes.push([...keys]));
  expect(state.globalVariables()).toEqual({ toggle_mode: '0', removed: 'old' });
  const value = { global: { toggle_mode: '1' } };
  const write = state.write({ kind: 'chat.metadata', key: 'macro_variables', value });
  expect(state.variable('toggle_mode', true)).toBe('1');
  expect(state.variable('removed', true)).toBeUndefined();
  const patch = { chat: { ...data.chat, metadata: { ...data.chat.metadata, macro_variables: value } } };
  changes.length = 0;
  state.apply(revision(2), structuredClone(patch), mutationId);
  expect(changes).toEqual([]);
  state.apply(revision(3), { chat: { ...data.chat, metadata: { ...data.chat.metadata, macro_variables: { global: { toggle_mode: '2' } } } } });
  expect(state.variable('toggle_mode', true)).toBe('2');
  acknowledge({ revision: revision(2), value: undefined, patch });
  await write;
  state.replace(data);
  expect(state.globalVariables()).toEqual({ toggle_mode: '2' });
  state.apply(revision(4), { chat: { ...data.chat, metadata: {} } });
  expect(state.globalVariables()).toEqual({});
});

test('failed global metadata writes roll back the frontend reader with the stored metadata', async () => {
  const data = initial();
  data.chat.metadata.macro_variables = { global: { toggle_mode: 0, empty: '', cleared: null, bool: false } };
  const state = new FrontendRuntimeState(data, async () => { throw new Error('Rejected'); }, () => {});
  expect(state.globalVariables()).toEqual({ toggle_mode: '0', empty: '', cleared: null, bool: 'false' });
  await expect(state.write({ kind: 'chat.metadata', key: 'macro_variables', value: { global: { toggle_mode: '1' } } })).rejects.toThrow('Rejected');
  expect(state.globalVariables()).toEqual({ toggle_mode: '0', empty: '', cleared: null, bool: 'false' });
  await expect(state.flush()).rejects.toThrow('Frontend Lua persistence failed');
});
