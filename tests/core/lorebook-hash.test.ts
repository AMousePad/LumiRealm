import { describe, test, expect } from "bun:test";
import {
  computeEntrySourceHash,
} from "../../src/core/mappers/lorebook-hash.js";

// Pinned by the module-migration over-archival bug: backend.ts injected
// `_risu_module_id` into extensions after the hash was stamped, so the
// recomputed hash never matched the stored one. Both `_risu_source_hash`
// and `_risu_module_id` must be stripped from the hash input.

function baseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: ["foo"],
    keysecondary: [],
    content: "hello",
    comment: "an entry",
    position: 4,
    depth: 0,
    role: null,
    order_value: 100,
    selective: false,
    constant: false,
    disabled: false,
    group_name: "",
    group_override: false,
    group_weight: 1,
    probability: 100,
    scan_depth: null,
    case_sensitive: false,
    match_whole_words: false,
    automation_id: null,
    use_regex: false,
    prevent_recursion: false,
    exclude_recursion: false,
    delay_until_recursion: false,
    priority: 0,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: false,
    extensions: {},
    ...overrides,
  };
}

describe("computeEntrySourceHash", () => {
  test("stable across calls for the same entry", () => {
    const e = baseEntry();
    expect(computeEntrySourceHash(e)).toBe(computeEntrySourceHash(e));
  });

  test("changes when a hash field changes", () => {
    const a = baseEntry();
    const b = baseEntry({ content: "different" });
    expect(computeEntrySourceHash(a)).not.toBe(computeEntrySourceHash(b));
  });

  test("ignores fields outside ENTRY_HASH_FIELDS (id, world_book_id, uid, timestamps)", () => {
    const a = baseEntry();
    const b = baseEntry({
      id: "uuid-a",
      world_book_id: "wb-1",
      uid: "uid-1",
      created_at: 100,
      updated_at: 200,
      vectorized: false,
      vector_index_status: "not_enabled",
      vector_indexed_at: null,
      vector_index_error: null,
      outlet_name: null,
    });
    expect(computeEntrySourceHash(a)).toBe(computeEntrySourceHash(b));
  });

  test("strips _risu_source_hash from extensions before hashing", () => {
    const a = baseEntry({ extensions: { custom: 1 } });
    const b = baseEntry({ extensions: { custom: 1, _risu_source_hash: "deadbeef" } });
    expect(computeEntrySourceHash(a)).toBe(computeEntrySourceHash(b));
  });

  test("strips _risu_module_id from extensions (the over-archival bug)", () => {
    const preStamp = baseEntry({ extensions: {} });
    const postStamp = baseEntry({
      extensions: {
        _risu_source_hash: computeEntrySourceHash(preStamp),
        _risu_module_id: "mod-123",
      },
    });
    expect(computeEntrySourceHash(postStamp)).toBe(computeEntrySourceHash(preStamp));
  });

  test("strips _risu_array_index from extensions (v6 backfill must not break hash matching)", () => {
    // Pinned by the v6 migration: existing entries lack _risu_array_index,
    // new translator output writes it. Hash must match across both states or
    // the source-hash → live-entry lookup in v6 silently breaks.
    const preBackfill = baseEntry({ extensions: { _risu_source_hash: "abc12345" } });
    const postBackfill = baseEntry({
      extensions: {
        _risu_source_hash: "abc12345",
        _risu_array_index: 42,
      },
    });
    expect(computeEntrySourceHash(postBackfill)).toBe(computeEntrySourceHash(preBackfill));
  });

  test("two entries differing only in _risu_array_index hash identically", () => {
    const a = baseEntry({ extensions: { _risu_array_index: 0 } });
    const b = baseEntry({ extensions: { _risu_array_index: 100 } });
    expect(computeEntrySourceHash(a)).toBe(computeEntrySourceHash(b));
  });

  test("INCLUDES _risu_decorators in hash (translator output, not system metadata)", () => {
    const a = baseEntry({ extensions: { _risu_decorators: [{ name: "depth", args: ["0"] }] } });
    const b = baseEntry({ extensions: {} });
    expect(computeEntrySourceHash(a)).not.toBe(computeEntrySourceHash(b));
  });

  test("treats missing/non-object extensions as empty", () => {
    const a = baseEntry({ extensions: undefined });
    const b = baseEntry({ extensions: null });
    const c = baseEntry({ extensions: [] });
    const d = baseEntry({ extensions: {} });
    const ref = computeEntrySourceHash(d);
    expect(computeEntrySourceHash(a)).toBe(ref);
    expect(computeEntrySourceHash(b)).toBe(ref);
    expect(computeEntrySourceHash(c)).toBe(ref);
  });
});
