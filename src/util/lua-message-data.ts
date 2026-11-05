import type { HostMessage } from '../interpreter/host.js';
import { toStr } from './coerce.js';
import { fnv1a } from './fnv1a.js';

type LuaMessageData = NonNullable<HostMessage['luaData']>;
type LuaMessageOptions = { createdAt?: number; luaData?: LuaMessageData };

const textStamp = (text: string): string => `${text.length}:${fnv1a(text)}`;

export function luaMessageData(message: Pick<HostMessage, 'content' | 'luaData'>): unknown {
  return message.luaData ? message.luaData.value : message.content;
}

export function luaMessageFields(value: unknown): Pick<HostMessage, 'content' | 'luaData'> {
  const content = toStr(value);
  return { content, luaData: typeof value === 'string' ? undefined : { value, text: textStamp(content) } };
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

// Time and raw data share one host value, and a host write replaces all of it, so every write must carry both.
export function luaOwnMetadata(options: { createdAt?: number; luaData?: LuaMessageData | null } | undefined): { ownMetadata?: unknown } {
  if (options?.createdAt === undefined && !options?.luaData) return {};
  return { ownMetadata: {
    ...(options.createdAt !== undefined ? { luaMessageTime: options.createdAt } : {}),
    ...(options.luaData ? { luaData: options.luaData } : {}),
  } };
}

export function readLuaOwnMetadata(own: unknown): LuaMessageOptions {
  const fields = (own && typeof own === 'object' ? own : {}) as { luaMessageTime?: unknown; luaData?: unknown };
  const { luaMessageTime: time, luaData: data } = fields;
  return {
    ...(typeof time === 'number' && Number.isFinite(time) ? { createdAt: time } : {}),
    ...(data && typeof data === 'object' && !Array.isArray(data) ? { luaData: data as LuaMessageData } : {}),
  };
}

export function hostLuaOwnMetadata(message: { ownMetadata?: unknown; metadata?: unknown; extra?: unknown }): LuaMessageOptions {
  return readLuaOwnMetadata(message.ownMetadata ?? (message.metadata as { lumirealm?: unknown } | undefined)?.lumirealm
    ?? (message.extra as { spindle_metadata?: { lumirealm?: unknown } } | undefined)?.spindle_metadata?.lumirealm);
}

// The host keeps this data across text changes, so it only counts while the stamp matches the current text.
export function hostLuaMessageData(message: { content: string; ownMetadata?: unknown; metadata?: unknown; extra?: unknown }): LuaMessageData | null {
  const data = hostLuaOwnMetadata(message).luaData;
  return data && data.text === textStamp(message.content) ? data : null;
}

export function luaMessageEdit(previous: HostMessage, next: HostMessage): { content: string | undefined; options: LuaMessageOptions & { role?: string } } | null {
  const dataChanged = luaMessageData(previous) !== luaMessageData(next);
  const timeChanged = (previous.createdAt ?? 0) !== (next.createdAt ?? 0);
  const roleChanged = previous.role !== next.role;
  if (!dataChanged && !timeChanged && !roleChanged) return null;
  const ownChanged = timeChanged || (dataChanged && Boolean(previous.luaData || next.luaData));
  return { content: dataChanged ? next.content : undefined, options: {
    ...(roleChanged ? { role: next.role } : {}),
    ...(ownChanged ? { createdAt: next.createdAt ?? 0, ...(next.luaData ? { luaData: next.luaData } : {}) } : {}),
  } };
}

// A plain string write over raw data whose text matches would otherwise leave the stamp valid.
export function luaPlainTextEditOptions(message: HostMessage): LuaMessageOptions | undefined {
  return message.luaData ? { createdAt: message.createdAt ?? 0 } : undefined;
}
