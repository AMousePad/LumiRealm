import { describe, test, expect } from "bun:test";
import {
  parseDecorators,
  applyDecoratorsToEntry,
  serializeDecorator,
  TIER1_DECORATORS,
  TIER2_DECORATORS,
} from "../../src/core/mappers/lorebook-decorators.js";
import { mapLoreBookEntryWithStats, mapLoreBook } from "../../src/core/mappers/lorebook.js";
import { loreBookSchema } from "../../src/core/schemas/lorebook.js";
import type { LumiWorldBookEntry } from "../../src/core/lumiverse/types.js";

// Risu source under test: ccardlib's decorator parser (function `Ce`) and
// lorebook.svelte.ts's per-decorator switch.

// Test helper: minimal LumiWorldBookEntry skeleton sufficient for
// applyDecoratorsToEntry. We only read `key` + `extensions`.
function draftEntry(overrides: Partial<LumiWorldBookEntry> = {}): Pick<LumiWorldBookEntry, "key" | "extensions"> {
  return {
    key: ["apple", "banana"],
    extensions: {},
    ...overrides,
  };
}

describe("parseDecorators — Risu Ce port", () => {
  test("empty input → no decorators, empty content", () => {
    const r = parseDecorators("");
    expect(r.decorators).toEqual([]);
    expect(r.remainingContent).toBe("");
  });

  test("plain content, no decorators → empty decorators list, full content", () => {
    const r = parseDecorators("hello world\nsecond line");
    expect(r.decorators).toEqual([]);
    expect(r.remainingContent).toBe("hello world\nsecond line");
  });

  test("single bare decorator + content", () => {
    const r = parseDecorators("@@activate\nbody text here");
    expect(r.decorators).toHaveLength(1);
    expect(r.decorators[0]).toMatchObject({ name: "activate", args: [], isFallback: false, lineIndex: 0 });
    expect(r.remainingContent).toBe("body text here");
  });

  test("decorator with single arg (no space → empty arg list per Risu)", () => {
    // Risu: g = h.indexOf(' '); if (g===-1) g = h.length;  arg = "".split(",").map(trim).filter ≠ ""
    const r = parseDecorators("@@activate\n");
    expect(r.decorators[0]?.args).toEqual([]);
  });

  test("decorator with single space-delimited arg", () => {
    const r = parseDecorators("@@depth 5\n");
    expect(r.decorators[0]).toMatchObject({ name: "depth", args: ["5"] });
  });

  test("decorator with comma-split args + whitespace trimming", () => {
    const r = parseDecorators("@@additional_keys foo, bar , baz\n");
    expect(r.decorators[0]?.args).toEqual(["foo", "bar", "baz"]);
  });

  test("empty comma-segments are filtered (per Risu .filter(b !== ''))", () => {
    const r = parseDecorators("@@additional_keys foo,,bar,\n");
    expect(r.decorators[0]?.args).toEqual(["foo", "bar"]);
  });

  test("multiple decorators, then content cutoff at first non-@@ line", () => {
    const r = parseDecorators("@@depth 3\n@@role assistant\n@@priority 5\nactual content\nmore content");
    expect(r.decorators.map((d) => d.name)).toEqual(["depth", "role", "priority"]);
    expect(r.remainingContent).toBe("actual content\nmore content");
  });

  test("blank line ends decorator block (.trim() makes it non-@@)", () => {
    const r = parseDecorators("@@activate\n\n@@depth 3\nbody");
    // Per Risu: blank line trimmed → '' → does not start with '@@' → falls through to content.
    expect(r.decorators).toHaveLength(1);
    expect(r.decorators[0]?.name).toBe("activate");
    expect(r.remainingContent).toBe("@@depth 3\nbody");
  });

  test("@@@end is rewritten to @@end (Risu: if (h === '@@@end') h = '@@end')", () => {
    const r = parseDecorators("@@@end\nbody");
    expect(r.decorators).toHaveLength(1);
    expect(r.decorators[0]?.name).toBe("end");
    expect(r.decorators[0]?.isFallback).toBe(false);
  });

  test("@@@<name> form is parsed with isFallback=true", () => {
    const r = parseDecorators("@@@activate\nbody");
    expect(r.decorators[0]).toMatchObject({ name: "activate", isFallback: true });
  });

  test("@@ with no name is silently skipped (Risu: if (e !== '') ...; else n=false)", () => {
    const r = parseDecorators("@@\n@@activate\nbody");
    expect(r.decorators.map((d) => d.name)).toEqual(["activate"]);
  });

  test("all-decorator content → empty remainingContent", () => {
    const r = parseDecorators("@@activate\n@@depth 5");
    expect(r.decorators).toHaveLength(2);
    expect(r.remainingContent).toBe("");
  });

  test("leading whitespace in decorator line is trimmed", () => {
    const r = parseDecorators("   @@activate\nbody");
    expect(r.decorators).toHaveLength(1);
    expect(r.decorators[0]?.name).toBe("activate");
  });

  test("remainingContent is .trim()'d (matches Risu's .trim())", () => {
    const r = parseDecorators("@@activate\n  body  \n");
    expect(r.remainingContent).toBe("body");
  });

  test("lineIndex preserved for diagnostics", () => {
    const r = parseDecorators("@@a\n@@b\n@@c\nbody");
    expect(r.decorators.map((d) => d.lineIndex)).toEqual([0, 1, 2]);
  });
});


describe("applyDecoratorsToEntry — Tier 1 mappings", () => {
  // ─── @@position ──────────────────────────────────────────────────────

  test("@@position before_desc → Lumi position=0 (before)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position before_desc\nbody").decorators);
    expect(r.patch.position).toBe(0);
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(r.stashed).toHaveLength(0);
  });

  test("@@position after_desc → Lumi position=1 (after)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position after_desc\nbody").decorators);
    expect(r.patch.position).toBe(1);
    expect(r.applied).toHaveLength(1);
  });

  test("@@position personality → STASHED (no Lumi mid-defs slot)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position personality\nbody").decorators);
    expect(r.patch.position).toBeUndefined();
    expect(r.stashed).toHaveLength(1);
    expect(r.stashed[0]?.name).toBe("position");
    expect(r.patch.extensions?._risu_decorators).toBeUndefined();
  });

  test("@@position scenario → STASHED", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position scenario\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
    expect(r.stashed[0]?.args).toEqual(["scenario"]);
  });

  test("@@position pt_anything → STASHED", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position pt_main\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
    expect(r.stashed[0]?.args).toEqual(["pt_main"]);
  });

  test("@@position with unknown value → DROPPED + suspends (Risu returns false)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@position bogus\nbody").decorators);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]?.reason).toContain("bogus");
  });

  // ─── @@depth / @@reverse_depth ──────────────────────────────────────

  test("@@depth 5 → position=4, depth=5", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@depth 5\nbody").decorators);
    expect(r.patch.position).toBe(4);
    expect(r.patch.depth).toBe(5);
  });

  test("@@depth NaN → DROPPED (Risu: if(NaN) return false)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@depth notanumber\nbody").decorators);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]?.reason).toContain("NaN");
  });

  test("@@reverse_depth 3 → position=4, depth=3 + reverse_depth note on extensions", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@reverse_depth 3\nbody").decorators);
    expect(r.patch.position).toBe(4);
    expect(r.patch.depth).toBe(3);
    expect(typeof r.patch.extensions?._risu_reverse_depth_note).toBe("string");
  });

  // ─── @@role ─────────────────────────────────────────────────────────

  test("@@role user → role='user'", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@role user\nbody").decorators);
    expect(r.patch.role).toBe("user");
  });

  test("@@role assistant → role='assistant'", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@role assistant\nbody").decorators);
    expect(r.patch.role).toBe("assistant");
  });

  test("@@role system → role='system'", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@role system\nbody").decorators);
    expect(r.patch.role).toBe("system");
  });

  test("@@role bogus → DROPPED (Risu rejects non-{user,assistant,system})", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@role bogus\nbody").decorators);
    expect(r.dropped).toHaveLength(1);
    expect(r.patch.role).toBeUndefined();
  });

  // ─── @@scan_depth ───────────────────────────────────────────────────

  test("@@scan_depth 7 → scan_depth=7", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@scan_depth 7\nbody").decorators);
    expect(r.patch.scan_depth).toBe(7);
  });

  test("@@scan_depth NaN → no override (Risu: parseInt without NaN check, propagates)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@scan_depth abc\nbody").decorators);
    expect(r.patch.scan_depth).toBeUndefined();
    expect(r.applied).toHaveLength(1); // Risu still treats as "applied" — value just propagates as NaN
  });

  // ─── @@priority / @@ignore_on_max_context ───────────────────────────

  test("@@priority 10 → priority=10", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@priority 10\nbody").decorators);
    expect(r.patch.priority).toBe(10);
  });

  test("@@priority -50 → priority=-50 (negative allowed)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@priority -50\nbody").decorators);
    expect(r.patch.priority).toBe(-50);
  });

  test("@@ignore_on_max_context → priority=-1000 (Risu's lowest-priority shortcut)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@ignore_on_max_context\nbody").decorators);
    expect(r.patch.priority).toBe(-1000);
  });

  // ─── @@probability ──────────────────────────────────────────────────

  test("@@probability 50 → probability=50, use_probability=true", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@probability 50\nbody").decorators);
    expect(r.patch.probability).toBe(50);
    expect(r.patch.use_probability).toBe(true);
  });

  test("@@probability NaN → DROPPED", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@probability foo\nbody").decorators);
    expect(r.dropped).toHaveLength(1);
  });

  // ─── @@additional_keys ──────────────────────────────────────────────

  test("@@additional_keys foo, bar → key[] = original + [foo, bar]", () => {
    const r = applyDecoratorsToEntry(draftEntry({ key: ["apple"] }), parseDecorators("@@additional_keys foo, bar\nbody").decorators);
    expect(r.patch.key).toEqual(["apple", "foo", "bar"]);
  });

  test("multiple @@additional_keys lines accumulate", () => {
    const r = applyDecoratorsToEntry(draftEntry({ key: ["x"] }), parseDecorators("@@additional_keys a\n@@additional_keys b, c\nbody").decorators);
    expect(r.patch.key).toEqual(["x", "a", "b", "c"]);
  });

  test("@@additional_keys with no args → no-op (no key change, applied)", () => {
    const r = applyDecoratorsToEntry(draftEntry({ key: ["x"] }), parseDecorators("@@additional_keys\nbody").decorators);
    expect(r.patch.key).toBeUndefined();
    expect(r.applied).toHaveLength(1);
  });

  // ─── @@match_full_word / @@match_partial_word ───────────────────────

  test("@@match_full_word → match_whole_words=true", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@match_full_word\nbody").decorators);
    expect(r.patch.match_whole_words).toBe(true);
  });

  test("@@match_partial_word → match_whole_words=false", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@match_partial_word\nbody").decorators);
    expect(r.patch.match_whole_words).toBe(false);
  });

  test("later match decorator wins", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@match_full_word\n@@match_partial_word\nbody").decorators);
    expect(r.patch.match_whole_words).toBe(false);
  });

  // ─── @@unrecursive / @@recursive / @@no_recursive_search ────────────
  // Risu has THREE recursion knobs that map to two distinct Lumi fields:
  //   - `@@unrecursive`/`@@recursive` (Risu lorebook.svelte.ts:498-505) gates
  //     `recursivePrompt.push` at :593 — i.e. whether THIS entry's content
  //     propagates to subsequent recursive scan passes. Lumi field:
  //     `prevent_recursion`.
  //   - `@@no_recursive_search` (Risu :506-509) gates the
  //     `recursivePrompt`-concat in `searchMatch` at :136-142 — i.e. whether
  //     THIS entry's keys are matched against accumulated lorebook content.
  //     Lumi field: `exclude_recursion` (per :485-488 "cannot be activated by
  //     a recursion pass").

  test("@@unrecursive → prevent_recursion=true", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@unrecursive\nbody").decorators);
    expect(r.patch.prevent_recursion).toBe(true);
    // `exclude_recursion` should NOT be set — that's a different decorator.
    expect(r.patch.exclude_recursion).toBeUndefined();
  });

  test("@@recursive → prevent_recursion=false", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@recursive\nbody").decorators);
    expect(r.patch.prevent_recursion).toBe(false);
    expect(r.patch.exclude_recursion).toBeUndefined();
  });

  test("@@no_recursive_search → exclude_recursion=true", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@no_recursive_search\nbody").decorators);
    expect(r.patch.exclude_recursion).toBe(true);
    // `prevent_recursion` is a different knob — must not be set.
    expect(r.patch.prevent_recursion).toBeUndefined();
  });

  test("@@unrecursive + @@no_recursive_search stack — both fields set", () => {
    const r = applyDecoratorsToEntry(
      draftEntry(),
      parseDecorators("@@unrecursive\n@@no_recursive_search\nbody").decorators,
    );
    expect(r.patch.prevent_recursion).toBe(true);
    expect(r.patch.exclude_recursion).toBe(true);
  });

  test("@@no_recursive_search is Tier 1 — NOT stashed for runtime", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@no_recursive_search\nbody").decorators);
    expect(r.applied.length).toBe(1);
    expect(r.applied[0]!.name).toBe("no_recursive_search");
    expect(r.stashed.length).toBe(0);
  });

  // ─── @@activate / @@dont_activate ───────────────────────────────────

  test("@@activate → constant=true (Lumi 'always-active' equivalent)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@activate\nbody").decorators);
    expect(r.patch.constant).toBe(true);
  });

  test("@@dont_activate → disabled=true", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@dont_activate\nbody").decorators);
    expect(r.patch.disabled).toBe(true);
  });

  // ─── @@end ──────────────────────────────────────────────────────────

  test("@@end → position=4 (depth-injected), depth=0 (Risu lorebook.svelte.ts:301-305)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@end\nbody").decorators);
    expect(r.patch.position).toBe(4);
    expect(r.patch.depth).toBe(0);
    expect(r.applied).toHaveLength(1);
  });

  test("@@@end is rewritten to @@end by parser → same effect", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@@end\nbody").decorators);
    expect(r.patch.position).toBe(4);
    expect(r.patch.depth).toBe(0);
  });
});


describe("applyDecoratorsToEntry — @@@ fallback chain semantics", () => {
  test("@@@<name> SKIPPED when previous decorator did NOT suspend", () => {
    // @@activate succeeds (no suspend); @@@activate following should be SKIPPED.
    const decs = parseDecorators("@@activate\n@@@activate\nbody").decorators;
    expect(decs).toHaveLength(2);
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    expect(r.applied).toHaveLength(1); // Only the first @@activate counted.
    expect(r.applied[0]?.isFallback).toBe(false);
  });

  test("@@@<name> RUNS when previous decorator suspended (returned false)", () => {
    // @@position bogus → drops (suspends); @@@position before_desc → fires.
    const decs = parseDecorators("@@position bogus\n@@@position before_desc\nbody").decorators;
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(1);
    expect(r.patch.position).toBe(0);
  });

  test("suspend chain: @@x bad → @@@y good clears suspend → @@@z skipped", () => {
    const decs = parseDecorators("@@position bogus\n@@@activate\n@@@dont_activate\nbody").decorators;
    expect(decs).toHaveLength(3);
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    // @@position bogus → dropped (suspends)
    // @@@activate → fires (suspended → consumed → clears suspend)
    // @@@dont_activate → SKIPPED (previous didn't suspend)
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(1);
    expect(r.patch.constant).toBe(true);
    expect(r.patch.disabled).toBeUndefined();
  });
});


describe("applyDecoratorsToEntry — Tier 2/3 stashing", () => {
  test("@@is_greeting 0 → STASHED (Tier 2 runtime gate, kept inline in content)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@is_greeting 0\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
    expect(r.stashed[0]?.name).toBe("is_greeting");
    expect(r.stashed[0]?.args).toEqual(["0"]);
    expect(r.patch.extensions?._risu_decorators).toBeUndefined();
  });

  test("@@activate_only_after 5 → STASHED", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@activate_only_after 5\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
  });

  test("@@exclude_keys foo,bar → STASHED (Lumi has no exclude-keys field)", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@exclude_keys foo, bar\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
    expect(r.stashed[0]?.args).toEqual(["foo", "bar"]);
  });

  test("@@inject_at NAME → STASHED", () => {
    const r = applyDecoratorsToEntry(draftEntry(), parseDecorators("@@inject_at description\nbody").decorators);
    expect(r.stashed).toHaveLength(1);
  });

  test("Tier 2 stash does NOT suspend (Risu DOES recognize these)", () => {
    // After a stashed Tier 2 decorator, a following @@@ should be SKIPPED
    // (because Tier 2 isn't a "drop" — Risu's callback didn't return false).
    const decs = parseDecorators("@@is_greeting 0\n@@@activate\nbody").decorators;
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    expect(r.applied.find((d) => d.name === "activate")).toBeUndefined();
  });

  test("unknown decorator name → DROPPED + suspend (Risu default case returns false)", () => {
    const decs = parseDecorators("@@completely_made_up_name 1, 2\n@@@activate\nbody").decorators;
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied.find((d) => d.name === "activate")).toBeDefined(); // suspension allowed @@@ to fire
  });
});


describe("applyDecoratorsToEntry — composition", () => {
  test("multiple Tier 1 decorators all apply to one entry", () => {
    const decs = parseDecorators(
      "@@position after_desc\n@@role assistant\n@@priority 10\n@@additional_keys foo, bar\n@@activate\nbody"
    ).decorators;
    const r = applyDecoratorsToEntry(draftEntry({ key: ["x"] }), decs);
    expect(r.patch).toMatchObject({
      position: 1,
      role: "assistant",
      priority: 10,
      key: ["x", "foo", "bar"],
      constant: true,
    });
    expect(r.applied).toHaveLength(5);
    expect(r.dropped).toHaveLength(0);
    expect(r.stashed).toHaveLength(0);
  });

  test("@@depth then @@position after_desc — last position wins", () => {
    const decs = parseDecorators("@@depth 3\n@@position after_desc\nbody").decorators;
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    // @@depth set position=4 then @@position after_desc set position=1.
    expect(r.patch.position).toBe(1);
    // depth value remains from @@depth (cleared not, just left)
    expect(r.patch.depth).toBe(3);
  });

  test("Tier 1 mixed with Tier 2 — Tier 2 stashed, Tier 1 applied", () => {
    const decs = parseDecorators("@@activate\n@@is_greeting 0\n@@priority 5\nbody").decorators;
    const r = applyDecoratorsToEntry(draftEntry(), decs);
    expect(r.applied.map((d) => d.name)).toEqual(["activate", "priority"]);
    expect(r.stashed.map((d) => d.name)).toEqual(["is_greeting"]);
    expect(r.patch.constant).toBe(true);
    expect(r.patch.priority).toBe(5);
  });

  test("Tier 2/3 stash does NOT touch extensions (kept inline in content instead)", () => {
    const r = applyDecoratorsToEntry(
      draftEntry({ extensions: { existing_key: "existing_value" } }),
      parseDecorators("@@is_greeting 0\nbody").decorators,
    );
    expect(r.patch.extensions).toBeUndefined();
    expect(r.stashed).toHaveLength(1);
  });

  test("no decorators → no patch fields, no extensions touch", () => {
    const r = applyDecoratorsToEntry(draftEntry(), []);
    expect(Object.keys(r.patch)).toEqual([]);
    expect(r.applied).toEqual([]);
    expect(r.stashed).toEqual([]);
    expect(r.dropped).toEqual([]);
  });
});


describe("Tier classification sanity", () => {
  test("TIER1_DECORATORS contains expected names", () => {
    expect(TIER1_DECORATORS.has("position")).toBe(true);
    expect(TIER1_DECORATORS.has("depth")).toBe(true);
    expect(TIER1_DECORATORS.has("activate")).toBe(true);
  });

  test("TIER2_DECORATORS contains the runtime-intercept and inject_* names", () => {
    expect(TIER2_DECORATORS.has("is_greeting")).toBe(true);
    expect(TIER2_DECORATORS.has("inject_lore")).toBe(true);
    expect(TIER2_DECORATORS.has("exclude_keys")).toBe(true);
    expect(TIER2_DECORATORS.has("disable_ui_prompt")).toBe(true);
  });

  test("Tier 1 and Tier 2 sets are disjoint", () => {
    for (const name of TIER1_DECORATORS) {
      expect(TIER2_DECORATORS.has(name)).toBe(false);
    }
  });
});

describe("serializeDecorator — round-trip", () => {
  test("@@<name> with no args round-trips", () => {
    const [d] = parseDecorators("@@unrecursive\n").decorators;
    expect(d).toBeDefined();
    expect(serializeDecorator(d!)).toBe("@@unrecursive");
  });

  test("@@<name> arg, arg round-trips", () => {
    const [d] = parseDecorators("@@exclude_keys foo, bar, baz\n").decorators;
    expect(d).toBeDefined();
    expect(serializeDecorator(d!)).toBe("@@exclude_keys foo, bar, baz");
  });

  test("@@@<name> fallback prefix round-trips", () => {
    const [d] = parseDecorators("@@@unrecursive\n").decorators;
    expect(d).toBeDefined();
    expect(serializeDecorator(d!)).toBe("@@@unrecursive");
  });

  test("re-parsing serialized output produces equivalent decorator", () => {
    const original = parseDecorators("@@is_greeting 0\n").decorators[0];
    expect(original).toBeDefined();
    const serialized = serializeDecorator(original!);
    const reparsed = parseDecorators(serialized + "\n").decorators[0];
    expect(reparsed?.name).toBe(original!.name);
    expect(reparsed?.args).toEqual([...original!.args]);
    expect(reparsed?.isFallback).toBe(original!.isFallback);
  });
});

describe("mapLoreBookEntryWithStats — Tier 2/3 stays inline in content", () => {
  function rb(content: string): import("../../src/core/schemas/lorebook.js").LoreBook {
    return loreBookSchema.parse({ key: "x", content });
  }
  const folders = new Map<string, string>();
  const now = 1234;
  const uuid = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  test("Tier 1 stripped, Tier 2/3 kept inline", () => {
    const lb = rb("@@unrecursive\n@@is_greeting 0\n@@depth 0\n<body>");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.content).toBe("@@is_greeting 0\n<body>");
    expect(r.entry.prevent_recursion).toBe(true);
    expect(r.entry.position).toBe(4);
    expect(r.entry.depth).toBe(0);
  });

  test("only Tier 1 → content fully stripped", () => {
    const lb = rb("@@unrecursive\n@@depth 5\n<body>");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.content).toBe("<body>");
  });

  test("only Tier 2/3 → content unchanged", () => {
    const lb = rb("@@is_greeting 0\n@@inject_at description\n<body>");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.content).toBe("@@is_greeting 0\n@@inject_at description\n<body>");
  });

  test("@@@-fallback chain preserves entire block", () => {
    const lb = rb("@@unknown_decorator\n@@@unrecursive\n<body>");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.content).toBe("@@unknown_decorator\n@@@unrecursive\n<body>");
    expect(r.entry.prevent_recursion).toBe(true);
  });

  test("no decorators → content unchanged byte-identical", () => {
    const lb = rb("just body text, no decorators here");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.content).toBe("just body text, no decorators here");
  });

  test("extensions._risu_decorators is NOT stamped", () => {
    const lb = rb("@@is_greeting 0\n<body>");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.extensions['_risu_decorators']).toBeUndefined();
  });
});

describe("mapLoreBookEntryWithStats — _risu_array_index from idx parameter", () => {
  function rb(content: string): import("../../src/core/schemas/lorebook.js").LoreBook {
    return loreBookSchema.parse({ key: "x", content });
  }
  const folders = new Map<string, string>();
  const now = 1234;
  const uuid = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  test("writes _risu_array_index from passed idx", () => {
    const lb = rb("body");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid, 7);
    expect(r.entry.extensions['_risu_array_index']).toBe(7);
  });

  test("defaults to 0 when idx omitted (test ergonomics)", () => {
    const lb = rb("body");
    const r = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid);
    expect(r.entry.extensions['_risu_array_index']).toBe(0);
  });

  test("array_index does not affect _risu_source_hash", () => {
    const lb = rb("body");
    const a = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid, 0);
    const b = mapLoreBookEntryWithStats(lb, "wb", folders, now, uuid, 99);
    expect(a.entry.extensions['_risu_source_hash']).toBe(b.entry.extensions['_risu_source_hash']);
  });

  test("mapLoreBook threads sequential indices to each entry", () => {
    const entries = [
      loreBookSchema.parse({ key: "a", content: "aa" }),
      loreBookSchema.parse({ key: "b", content: "bb" }),
      loreBookSchema.parse({ key: "c", content: "cc" }),
    ];
    const out = mapLoreBook(entries, { worldBookId: "wb", now: () => now, uuid });
    expect(out.length).toBe(3);
    expect(out[0]!.extensions['_risu_array_index']).toBe(0);
    expect(out[1]!.extensions['_risu_array_index']).toBe(1);
    expect(out[2]!.extensions['_risu_array_index']).toBe(2);
  });
});
