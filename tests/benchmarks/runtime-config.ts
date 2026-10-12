import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';

let calls = 0;
const messages = Array.from({ length: 1000 }, (_, index) => ({
  id: String(index), role: index % 2 ? 'user' : 'assistant', content: 'message '.repeat(128), created_at: index,
}));
const lore = Array.from({ length: 50 }, (_, index) => ({ id: String(index), content: 'lore '.repeat(128) }));
(globalThis as { spindle?: unknown }).spindle = {
  characters: { get: async () => { calls++; return { name: 'Character', world_book_ids: ['a', 'b'] }; } },
  personas: { getActive: async () => { calls++; return null; } },
  chat: { getMessages: async () => { calls++; return messages; } },
  chats: { get: async () => { calls++; return { metadata: {} }; } },
  world_books: { entries: { list: async () => { calls++; return { data: lore }; } } },
};
const active = { card: { character_id: 'character', asset_index: {}, emotion_index: {},
  risuPayload: { triggers: [], lua_scripts: [], at_actions: [], scriptstate_defaults: {} },
} } as unknown as ActiveCard;
const deps = { modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false, getCompiledLibraries: () => [] };
const run = () => assembleRuntimeConfig(deps, active, 'chat', 'user');
for (let i = 0; i < 10; i++) await run();
calls = 0;
const start = performance.now();
for (let i = 0; i < 100; i++) await run();
const meanMs = (performance.now() - start) / 100;
const hostCalls = calls / 100;
const value = await run();
console.log(JSON.stringify({ messages: messages.length, loreEntries: lore.length * 2, meanMs, hostCalls,
  serializedBytes: new TextEncoder().encode(JSON.stringify(value)).length }));
delete (globalThis as { spindle?: unknown }).spindle;
