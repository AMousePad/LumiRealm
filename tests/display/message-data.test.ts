import { expect, test } from 'bun:test';
import { withCurrentDisplayMessage } from '../../src/display/host-shim.js';
import { snapshotMessagesChanged } from '../../src/display/snapshot.js';
import { luaMessageData } from '../../src/util/lua-message-data.js';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { snapshot } from '../helpers/display-lua-fixture.js';

test('pending display text supersedes raw Lua data and type-only changes invalidate message dependencies', () => {
  const snap = { ...snapshot(''), messagesHost: [{ id: 'message', content: '42', role: 'user', luaData: { value: 42 } }] };
  const context = { messageId: 'message', role: 'user' as const, isUser: true, depth: 0, chatId: snap.chatId, characterId: snap.characterId };
  expect(luaMessageData(withCurrentDisplayMessage(snap, context, '42').messagesHost[0]!)).toBe(42);
  const pending = withCurrentDisplayMessage(snap, context, 'Pending text');
  expect(luaMessageData(pending.messagesHost[0]!)).toBe('Pending text');
  expect(snapshotMessagesChanged(snap, { ...snap, messagesHost: [{ ...snap.messagesHost[0]!, luaData: null }] })).toBe(true);
  expect(snapshotMessagesChanged(snap, structuredClone(snap))).toBe(false);
});

test('native position updates preserve pending display data while type-only updates reach canonical views', async () => {
  const f = frontendRuntime();
  const native = f.dto.messages[1]!;
  native.content = '42'; native.extra = { spindle_content_metadata: { lumirealm: { value: 42 } } };
  f.event({ message: native });
  const canonical = f.state.displayChat(f.state.hostMessages(), undefined);
  const pending = f.state.displayChat(f.state.hostMessages().map(message => message.id === native.id ? { ...message, content: 'Pending', luaData: null } : message), undefined);
  try {
    f.event({ message: { ...native, index_in_chat: 2 } });
    expect(luaMessageData(pending.chat.messages.find(message => message.id === native.id)!)).toBe('Pending');
    expect(luaMessageData(canonical.chat.messages.find(message => message.id === native.id)!)).toBe(42);
    delete native.extra.spindle_content_metadata;
    f.event({ message: native });
    expect(luaMessageData(canonical.chat.messages.find(message => message.id === native.id)!)).toBe('42');
  } finally { canonical.release(); pending.release(); }
});
