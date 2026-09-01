import { describe, test, expect } from "bun:test";
import {
  EMPTY_MIGRATION_STATE,
  MIGRATION_STATE_PATH,
  parseMigrationState,
  readMigrationState,
  writeMigrationState,
  type MigrationState,
  type UserStorageLike,
} from "../../src/migrations/state.js";

// In-memory fake of the userStorage surface.
function makeFakeStorage(initial: Record<string, unknown> = {}): UserStorageLike & {
  data: Record<string, unknown>;
} {
  const data = { ...initial };
  return {
    data,
    async getJson<T>(path: string): Promise<T> {
      return data[path] as T;
    },
    async setJson(path: string, value: unknown): Promise<void> {
      data[path] = value;
    },
  };
}

// Boolean one-shot markers, all default false.
const FLAGS = {
  display_owner_backfilled: false,
  retired_macro_projection_migrated_v2: false,
  vars_migrated_to_chat_scope: false,
};

describe("parseMigrationState", () => {
  test("returns empty for null/undefined/non-object input", () => {
    expect(parseMigrationState(null)).toEqual(EMPTY_MIGRATION_STATE);
    expect(parseMigrationState(undefined)).toEqual(EMPTY_MIGRATION_STATE);
    expect(parseMigrationState("not an object")).toEqual(EMPTY_MIGRATION_STATE);
    expect(parseMigrationState(42)).toEqual(EMPTY_MIGRATION_STATE);
  });

  test("returns empty when schema_version mismatches (forward incompat)", () => {
    expect(parseMigrationState({ schema_version: 2, last_swept_modules: 5 })).toEqual(
      EMPTY_MIGRATION_STATE,
    );
  });

  test("reads new-shape file with both markers", () => {
    expect(
      parseMigrationState({
        schema_version: 1,
        last_swept_modules: 5,
        last_swept_characters: 4,
        ...FLAGS,
      }),
    ).toEqual({
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 4,
      ...FLAGS,
    });
  });

  test("legacy single-marker file: last_swept_translator_version becomes modules marker", () => {
    expect(
      parseMigrationState({
        schema_version: 1,
        last_swept_translator_version: 4,
      }),
    ).toEqual({
      schema_version: 1,
      last_swept_modules: 4,
      last_swept_characters: 0,
      ...FLAGS,
    });
  });

  test("legacy + new fields coexisting: new fields win", () => {
    expect(
      parseMigrationState({
        schema_version: 1,
        last_swept_translator_version: 1,
        last_swept_modules: 7,
        last_swept_characters: 6,
      }),
    ).toEqual({
      schema_version: 1,
      last_swept_modules: 7,
      last_swept_characters: 6,
      ...FLAGS,
    });
  });

  test("missing fields default to 0", () => {
    expect(parseMigrationState({ schema_version: 1 })).toEqual({
      schema_version: 1,
      last_swept_modules: 0,
      last_swept_characters: 0,
      ...FLAGS,
    });
  });

  test("non-numeric field values fall back to 0", () => {
    expect(
      parseMigrationState({
        schema_version: 1,
        last_swept_modules: "5",
        last_swept_characters: null,
      }),
    ).toEqual({
      schema_version: 1,
      last_swept_modules: 0,
      last_swept_characters: 0,
      ...FLAGS,
    });
  });
});

describe("readMigrationState", () => {
  test("returns empty when path is unset", async () => {
    const storage = makeFakeStorage();
    const result = await readMigrationState(storage, "user-1");
    expect(result).toEqual(EMPTY_MIGRATION_STATE);
  });

  test("returns empty when storage throws", async () => {
    const storage: UserStorageLike = {
      async getJson(): Promise<never> {
        throw new Error("boom");
      },
      async setJson(): Promise<void> {},
    };
    const result = await readMigrationState(storage, "user-1");
    expect(result).toEqual(EMPTY_MIGRATION_STATE);
  });

  test("upgrades legacy file to two-domain shape on read (modules carries forward)", async () => {
    const storage = makeFakeStorage({
      [MIGRATION_STATE_PATH]: {
        schema_version: 1,
        last_swept_translator_version: 4,
      },
    });
    const result = await readMigrationState(storage, "user-1");
    expect(result.last_swept_modules).toBe(4);
    expect(result.last_swept_characters).toBe(0);
  });
});

describe("writeMigrationState", () => {
  test("strips legacy field on write (no last_swept_translator_version persisted)", async () => {
    const storage = makeFakeStorage({
      [MIGRATION_STATE_PATH]: {
        schema_version: 1,
        last_swept_translator_version: 4,
      },
    });
    const next: MigrationState = {
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 5,
      ...FLAGS,
    };
    await writeMigrationState(storage, "user-1", next);
    const written = storage.data[MIGRATION_STATE_PATH] as Record<string, unknown>;
    expect(written).toEqual({
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 5,
      ...FLAGS,
    });
    expect("last_swept_translator_version" in written).toBe(false);
  });

  test("round-trips: write then read returns the same state", async () => {
    const storage = makeFakeStorage();
    const next: MigrationState = {
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 3,
      ...FLAGS,
    };
    await writeMigrationState(storage, "user-1", next);
    const result = await readMigrationState(storage, "user-1");
    expect(result).toEqual(next);
  });

  test("two-domain markers advance independently (modules set, characters unset)", async () => {
    const storage = makeFakeStorage();
    await writeMigrationState(storage, "user-1", {
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 0,
      ...FLAGS,
    });
    let s = await readMigrationState(storage, "user-1");
    expect(s).toEqual({
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 0,
      ...FLAGS,
    });
    await writeMigrationState(storage, "user-1", { ...s, last_swept_characters: 5 });
    s = await readMigrationState(storage, "user-1");
    expect(s).toEqual({
      schema_version: 1,
      last_swept_modules: 5,
      last_swept_characters: 5,
      ...FLAGS,
    });
  });
});
