import { hostLuaOwnMetadata } from './lua-message-data.js';

// Lumiverse stores seconds; Risu message timestamps and compatibility clocks use milliseconds.
export function hostMessageTime(message: { send_date?: unknown; created_at?: unknown; ownMetadata?: unknown; metadata?: unknown; extra?: unknown }): number {
  const override = hostLuaOwnMetadata(message).createdAt;
  if (override !== undefined) return override;
  const seconds = typeof message.send_date === 'number' ? message.send_date
    : typeof message.created_at === 'number' ? message.created_at : 0;
  return seconds * 1000;
}
