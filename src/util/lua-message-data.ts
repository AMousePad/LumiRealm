import type { HostMessage } from '../interpreter/host.js';
import { toStr } from './coerce.js';

export function luaMessageData(message: Pick<HostMessage, 'content' | 'luaData'>): unknown {
  return message.luaData ? message.luaData.value : message.content;
}

export function luaMessageFields(value: unknown): Pick<HostMessage, 'content' | 'luaData'> {
  return { content: toStr(value), luaData: typeof value === 'string' ? undefined : { value } };
}

export function hostLuaMessageData(message: { ownContentMetadata?: unknown; extra?: unknown }): NonNullable<HostMessage['luaData']> | null {
  const own = message.ownContentMetadata ?? (message.extra as { spindle_content_metadata?: { lumirealm?: unknown } } | undefined)?.spindle_content_metadata?.lumirealm;
  return own && typeof own === 'object' && !Array.isArray(own) ? own as { value?: unknown } : null;
}
