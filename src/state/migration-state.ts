// Two-domain sweep markers for the translator-schema mass migrations.
// Legacy single-marker files are read as modules-only.

export const MIGRATION_STATE_PATH = 'lumirealm/migration-state.json';

export interface MigrationState {
  readonly schema_version: 1;
  readonly last_swept_modules: number;
  readonly last_swept_characters: number;
  readonly display_owner_backfilled: boolean;
  // One-time sweep that un-prefixes legacy risu_* macros back to raw Risu CBS
  // across every stored string surface (translate-time prefixing retired).
  readonly macros_unprefixed: boolean;
  // One-time move of per-chat scriptstate from macro_variables.local (transient
  // in Lumi) to chat_variables (natively persisted + rehydrated).
  readonly vars_migrated_to_chat_scope: boolean;
}

export const EMPTY_MIGRATION_STATE: MigrationState = {
  schema_version: 1,
  last_swept_modules: 0,
  last_swept_characters: 0,
  display_owner_backfilled: false,
  macros_unprefixed: false,
  vars_migrated_to_chat_scope: false,
};

export interface UserStorageLike {
  getJson<T = unknown>(
    path: string,
    options?: { fallback?: T; userId?: string },
  ): Promise<T>;
  setJson(
    path: string,
    value: unknown,
    options?: { indent?: number; userId?: string },
  ): Promise<void>;
}

export function parseMigrationState(raw: unknown): MigrationState {
  if (!raw || typeof raw !== 'object') return EMPTY_MIGRATION_STATE;
  const obj = raw as {
    schema_version?: unknown;
    last_swept_modules?: unknown;
    last_swept_characters?: unknown;
    last_swept_translator_version?: unknown;
    display_owner_backfilled?: unknown;
    macros_unprefixed?: unknown;
    vars_migrated_to_chat_scope?: unknown;
  };
  if (obj.schema_version !== 1) return EMPTY_MIGRATION_STATE;
  const legacy =
    typeof obj.last_swept_translator_version === 'number'
      ? obj.last_swept_translator_version
      : 0;
  return {
    schema_version: 1,
    last_swept_modules:
      typeof obj.last_swept_modules === 'number' ? obj.last_swept_modules : legacy,
    last_swept_characters:
      typeof obj.last_swept_characters === 'number' ? obj.last_swept_characters : 0,
    display_owner_backfilled: obj.display_owner_backfilled === true,
    macros_unprefixed: obj.macros_unprefixed === true,
    vars_migrated_to_chat_scope: obj.vars_migrated_to_chat_scope === true,
  };
}

export async function readMigrationState(
  storage: UserStorageLike,
  userId: string,
): Promise<MigrationState> {
  try {
    const raw = await storage.getJson<unknown>(MIGRATION_STATE_PATH, { userId });
    return parseMigrationState(raw);
  } catch {
    return EMPTY_MIGRATION_STATE;
  }
}

export async function writeMigrationState(
  storage: UserStorageLike,
  userId: string,
  state: MigrationState,
): Promise<void> {
  const out: MigrationState = {
    schema_version: 1,
    last_swept_modules: state.last_swept_modules,
    last_swept_characters: state.last_swept_characters,
    display_owner_backfilled: state.display_owner_backfilled,
    macros_unprefixed: state.macros_unprefixed,
    vars_migrated_to_chat_scope: state.vars_migrated_to_chat_scope,
  };
  await storage.setJson(MIGRATION_STATE_PATH, out, { indent: 2, userId });
}
