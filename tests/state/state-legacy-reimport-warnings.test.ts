import { describe, test, expect } from "bun:test";
import {
  LEGACY_REIMPORT_WARNED_PATH,
  markLegacyReimportWarned,
  parseLegacyReimportWarned,
  readLegacyReimportWarned,
  type UserStorageLike,
} from "../../src/state/legacy-reimport-warnings.js";

function makeFakeStorage(initial: Record<string, unknown> = {}): UserStorageLike & {
  data: Record<string, unknown>;
  writeCount: number;
} {
  const data = { ...initial };
  let writeCount = 0;
  return {
    data,
    get writeCount() { return writeCount; },
    async getJson<T>(path: string): Promise<T> {
      return data[path] as T;
    },
    async setJson(path: string, value: unknown): Promise<void> {
      writeCount += 1;
      data[path] = value;
    },
  };
}

describe("parseLegacyReimportWarned", () => {
  test("returns empty for null/undefined/non-object", () => {
    expect(parseLegacyReimportWarned(null).size).toBe(0);
    expect(parseLegacyReimportWarned(undefined).size).toBe(0);
    expect(parseLegacyReimportWarned("nope").size).toBe(0);
  });

  test("returns empty when schema_version mismatches", () => {
    expect(
      parseLegacyReimportWarned({ schema_version: 2, character_ids: ["a"] }).size,
    ).toBe(0);
  });

  test("reads the character_ids array into a Set", () => {
    const set = parseLegacyReimportWarned({
      schema_version: 1,
      character_ids: ["char-a", "char-b"],
    });
    expect([...set].sort()).toEqual(["char-a", "char-b"]);
  });

  test("filters non-string entries from character_ids", () => {
    const set = parseLegacyReimportWarned({
      schema_version: 1,
      character_ids: ["char-a", 42, null, "char-b"],
    });
    expect([...set].sort()).toEqual(["char-a", "char-b"]);
  });
});

describe("readLegacyReimportWarned", () => {
  test("returns empty when path is unset", async () => {
    const storage = makeFakeStorage();
    const set = await readLegacyReimportWarned(storage, "user-1");
    expect(set.size).toBe(0);
  });

  test("returns empty when storage throws", async () => {
    const storage: UserStorageLike = {
      async getJson(): Promise<never> {
        throw new Error("boom");
      },
      async setJson(): Promise<void> {},
    };
    const set = await readLegacyReimportWarned(storage, "user-1");
    expect(set.size).toBe(0);
  });
});

describe("markLegacyReimportWarned", () => {
  test("first call writes the file and returns alreadyWarned=false", async () => {
    const storage = makeFakeStorage();
    const result = await markLegacyReimportWarned(storage, "user-1", "char-a");
    expect(result.alreadyWarned).toBe(false);
    expect(storage.data[LEGACY_REIMPORT_WARNED_PATH]).toEqual({
      schema_version: 1,
      character_ids: ["char-a"],
    });
  });

  test("second call for same character returns alreadyWarned=true and does NOT rewrite", async () => {
    const storage = makeFakeStorage();
    await markLegacyReimportWarned(storage, "user-1", "char-a");
    const writeCountAfterFirst = storage.writeCount;
    const result = await markLegacyReimportWarned(storage, "user-1", "char-a");
    expect(result.alreadyWarned).toBe(true);
    expect(storage.writeCount).toBe(writeCountAfterFirst);
  });

  test("different characters accumulate", async () => {
    const storage = makeFakeStorage();
    await markLegacyReimportWarned(storage, "user-1", "char-a");
    await markLegacyReimportWarned(storage, "user-1", "char-b");
    await markLegacyReimportWarned(storage, "user-1", "char-c");
    const set = await readLegacyReimportWarned(storage, "user-1");
    expect([...set].sort()).toEqual(["char-a", "char-b", "char-c"]);
  });

  test("survives a 'reboot' (storage object reused) — set is read from disk", async () => {
    const storage = makeFakeStorage();
    await markLegacyReimportWarned(storage, "user-1", "char-a");
    // Simulate reboot: re-read from the same backing store.
    const set = await readLegacyReimportWarned(storage, "user-1");
    expect(set.has("char-a")).toBe(true);
    const result = await markLegacyReimportWarned(storage, "user-1", "char-a");
    expect(result.alreadyWarned).toBe(true);
  });

  test("upgrades from legacy file with extra fields by preserving existing character_ids", async () => {
    const storage = makeFakeStorage({
      [LEGACY_REIMPORT_WARNED_PATH]: {
        schema_version: 1,
        character_ids: ["char-old"],
        unknown_field: "ignored",
      },
    });
    await markLegacyReimportWarned(storage, "user-1", "char-new");
    const set = await readLegacyReimportWarned(storage, "user-1");
    expect([...set].sort()).toEqual(["char-new", "char-old"]);
  });
});
