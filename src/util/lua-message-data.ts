import type { HostMessage } from '../interpreter/host.js';
import { toStr } from './coerce.js';

export function luaMessageData(message: Pick<HostMessage, 'content' | 'luaData'>): unknown {
  return message.luaData ? message.luaData.value : message.content;
}

export function luaMessageFields(value: unknown): Pick<HostMessage, 'content' | 'luaData'> {
  return { content: toStr(value), luaData: typeof value === 'string' ? undefined : { value } };
}

const LUA_UNSAFE_STRING = /[\0\p{Cs}]/u;
const utf8 = new TextEncoder();

// Rows as JSON, a newline, then string bodies back to back, so Lua can slice bodies instead of JSON-decoding them.
// NUL and lone surrogates stay in the JSON because a pushed Lua string cannot carry them unchanged.
export function encodeFullChatParts(rows: readonly { readonly role: string; readonly data: unknown; readonly time: number }[]): string {
  const bodies: string[] = [];
  const head = rows.map(({ role, data, time }) => {
    if (typeof data !== 'string' || LUA_UNSAFE_STRING.test(data)) return { role, data, time };
    bodies.push(data);
    return { role, time, len: utf8.encode(data).length };
  });
  return `${JSON.stringify(head)}\n${bodies.join('')}`;
}

export function hostLuaMessageData(message: { ownContentMetadata?: unknown; extra?: unknown }): NonNullable<HostMessage['luaData']> | null {
  const own = message.ownContentMetadata ?? (message.extra as { spindle_content_metadata?: { lumirealm?: unknown } } | undefined)?.spindle_content_metadata?.lumirealm;
  return own && typeof own === 'object' && !Array.isArray(own) ? own as { value?: unknown } : null;
}
