declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

const PATH = 'lumirealm/toggle-preferences.json';
const chains = new Map<string, Promise<unknown>>();

function exclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (!userId) throw new TypeError('Toggle preferences require a user ID');
  const previous = chains.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(userId, tail);
  void tail.then(() => { if (chains.get(userId) === tail) chains.delete(userId); });
  return run;
}

export class TogglePreferencesError extends TypeError {
  constructor(cause: unknown) {
    super(`Toggle preferences could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'TogglePreferencesError';
  }
}

async function read(userId: string): Promise<Record<string, string> | null> {
  try {
    const raw = await spindle.userStorage.getJson<unknown>(PATH, { fallback: null, userId });
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('Invalid toggle preferences');
    }
    for (const [key, value] of Object.entries(raw)) {
      if (!key.startsWith('toggle_') || typeof value !== 'string') {
        throw new TypeError('Invalid toggle preference entry');
      }
    }
    return raw as Record<string, string>;
  } catch (error) {
    throw new TogglePreferencesError(error);
  }
}

function toggles(legacy: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(legacy).filter(([key]) => key.startsWith('toggle_')));
}

export async function initializeTogglePreferences(userId: string, legacy: Record<string, string>): Promise<void> {
  await exclusive(userId, async () => {
    if (await read(userId) === null) {
      await spindle.userStorage.setJson(PATH, toggles(legacy), { userId });
    }
  });
}

/**
 * Collect the chat-scoped ("legacy") globals the effective-global overlay starts
 * from: every host global (chat metadata `macro_variables.global`) plus any
 * `toggle_*` value that only exists in the host local map or in the host
 * preset prompt-variable snapshot. Shared by the macro interceptor and by the
 * Spindle compatibility macros so both read one definition of "legacy".
 */
export function collectLegacyGlobals(sources: {
  readonly global?: unknown;
  readonly local?: unknown;
  readonly promptVariables?: unknown;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const copy = (raw: unknown, toggleOnly: boolean): void => {
    if (!raw || typeof raw !== 'object') return;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (toggleOnly && !key.startsWith('toggle_')) continue;
      if (toggleOnly && Object.hasOwn(out, key)) continue;
      out[key] = typeof value === 'string' ? value : String(value);
    }
  };
  copy(sources.global, false);
  copy(sources.local, true);
  copy(sources.promptVariables, true);
  return out;
}

/**
 * Overlay the toggle stores on the legacy globals, lowest precedence first:
 * preset variables the host resolved for the chat, then the chat globals, then
 * the persisted per-user preferences. Preferences are the only source that can
 * hide a legacy toggle, so deleting one cannot resurrect an old chat value, and
 * a key no store defines stays missing.
 */
export function mergeEffectiveGlobals(
  legacy: Record<string, string>,
  preferences: Record<string, string> | null,
  presetToggles: Readonly<Record<string, string>> = {},
): Record<string, string> {
  if (preferences === null) return { ...presetToggles, ...legacy };
  return {
    ...presetToggles,
    ...Object.fromEntries(Object.entries(legacy).filter(([key]) => !key.startsWith('toggle_'))),
    ...preferences,
  };
}

/** Uncached read of the persisted preferences. `null` = never initialized. */
export async function readTogglePreferences(userId: string): Promise<Record<string, string> | null> {
  return read(userId);
}

export async function readEffectiveGlobals(
  userId: string,
  legacy: Record<string, string>,
  presetToggles: Readonly<Record<string, string>> = {},
): Promise<Record<string, string>> {
  return exclusive(userId, async () => mergeEffectiveGlobals(legacy, await read(userId), presetToggles));
}

export async function writeTogglePreference(userId: string, key: string, value: string | null, legacy: Record<string, string>): Promise<void> {
  if (!key.startsWith('toggle_')) throw new TypeError('Invalid toggle preference key');
  await exclusive(userId, async () => {
    const preferences = await read(userId) ?? toggles(legacy);
    if (value === null) delete preferences[key];
    else preferences[key] = value;
    await spindle.userStorage.setJson(PATH, preferences, { userId });
  });
}
