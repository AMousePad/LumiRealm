// Preset-defined toggles live in the host preset prompt-variable store, which
// LumiRealm's readers cannot query. The host resolves those values for the
// chat-bound preset during prompt assembly and hands the snapshot to the macro
// interceptor on `env.extra`, so the last resolved snapshot is cached per chat
// and merged into the effective-globals overlay as its lowest layer.

interface PresetToggleSnapshot {
  readonly ownerUserId: string;
  readonly presetId: string | null;
  readonly values: Record<string, string>;
}

const snapshots = new Map<string, PresetToggleSnapshot>();

// Only scalar toggle_* entries are carried over; every other prompt variable
// stays host-owned.
function toggleValues(promptVariables: unknown): Record<string, string> | null {
  if (!promptVariables || typeof promptVariables !== 'object' || Array.isArray(promptVariables)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(promptVariables as Record<string, unknown>)) {
    if (!key.startsWith('toggle_')) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    out[key] = String(value);
  }
  return out;
}

/**
 * Record the preset prompt-variable snapshot the host resolved for one chat.
 * An env without a preset identity (display and response phases) keeps the last
 * snapshot, while a different preset id replaces it so a preset switch cannot
 * leave the previous preset's toggles behind.
 */
export function recordPresetToggleValues(
  chatId: string,
  userId: string,
  presetId: unknown,
  promptVariables: unknown,
): void {
  const id = typeof presetId === 'string' && presetId.length > 0 ? presetId : null;
  const values = toggleValues(promptVariables);
  const current = snapshots.get(chatId);
  if (id === null && values === null) return;
  if (values === null && current?.ownerUserId === userId && current.presetId === id) return;
  snapshots.set(chatId, { ownerUserId: userId, presetId: id, values: values ?? {} });
}

/**
 * Preset-defined toggle values for a chat. Empty when the chat is unknown, the
 * owner differs, or no assembly has resolved a preset for it yet, so a key no
 * store defines stays missing.
 */
export function presetToggleValues(chatId: string, userId: string): Record<string, string> {
  const hit = snapshots.get(chatId);
  if (!hit || !userId || hit.ownerUserId !== userId) return {};
  return hit.values;
}

/** Drop cached snapshots, for tests and chat teardown. */
export function resetPresetToggleValues(chatId?: string): void {
  if (chatId === undefined) snapshots.clear();
  else snapshots.delete(chatId);
}
