// Lumiverse stores seconds; Risu message timestamps and compatibility clocks use milliseconds.
export function hostMessageTime(message: { send_date?: unknown; created_at?: unknown; ownMetadata?: unknown; metadata?: unknown; extra?: unknown }): number {
  const own = message.ownMetadata ?? (message.metadata as { lumirealm?: unknown } | undefined)?.lumirealm
    ?? (message.extra as { spindle_metadata?: { lumirealm?: unknown } } | undefined)?.spindle_metadata?.lumirealm;
  const override = (own as { luaMessageTime?: unknown } | null)?.luaMessageTime;
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const seconds = typeof message.send_date === 'number' ? message.send_date
    : typeof message.created_at === 'number' ? message.created_at : 0;
  return seconds * 1000;
}
