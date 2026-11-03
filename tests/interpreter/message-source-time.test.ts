import { expect, test } from 'bun:test';
import { hostMessageTime } from '../../src/util/message-time.js';

test('Lua message time survives runtime replies, chat DTOs and native events', () => {
  const own = { luaMessageTime: 0 };
  for (const shape of [{ ownMetadata: own }, { metadata: { lumirealm: own } }, { extra: { spindle_metadata: { lumirealm: own } } }]) {
    expect(hostMessageTime({ send_date: 1900000000, ...shape })).toBe(0);
  }
  expect(hostMessageTime({ send_date: 1700000000 })).toBe(1700000000000);
});
