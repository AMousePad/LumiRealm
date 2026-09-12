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

export async function readEffectiveGlobals(userId: string, legacy: Record<string, string>): Promise<Record<string, string>> {
  return exclusive(userId, async () => {
    const preferences = await read(userId);
    if (preferences === null) return { ...legacy };
    // Remove legacy toggles before overlaying so deletion cannot resurrect an old chat value.
    return { ...Object.fromEntries(Object.entries(legacy).filter(([key]) => !key.startsWith('toggle_'))), ...preferences };
  });
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
