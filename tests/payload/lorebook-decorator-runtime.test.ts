import { describe, test, expect } from "bun:test";
import {
  isGreetingPredicate,
  activateOnlyAfterPredicate,
  activateOnlyEveryPredicate,
  dontActivateAfterMatchPredicate,
  keepActivateAfterMatchPredicate,
  excludeKeysPredicate,
  excludeKeysAllPredicate,
  entryMatchedScanWindow,
  evaluatePreActivationGates,
  runWorldInfoInterceptor,
  parseInjectPlan,
  applyInjectMerge,
  readPositionPtName,
  computeInjectAndPositionPlans,
  applyInjectAtToMessages,
  TIER2_PRE_ACTIVATION_GATES,
  type WorldInfoCtx,
  type WorldInfoEntryView,
  type InjectAtPlan,
  type ApplyInjectAtMessage,
} from "../../src/payload/lorebook-decorator-runtime.js";

function ctx(input: Partial<WorldInfoCtx> = {}): WorldInfoCtx {
  return {
    entries: [],
    messages: [],
    chatTurn: 0,
    chatMetadata: {},
    defaultScanDepth: 4,
    ...input,
  };
}

function entry(overrides: Partial<WorldInfoEntryView> = {}): WorldInfoEntryView {
  return {
    id: "e1",
    disabled: false,
    comment: "",
    key: [],
    keysecondary: [],
    content: "",
    priority: 0,
    extensions: {},
    ...overrides,
  };
}

describe("TIER2_PRE_ACTIVATION_GATES set", () => {
  test("contains the seven supported gates", () => {
    expect([...TIER2_PRE_ACTIVATION_GATES].sort()).toEqual([
      "activate_only_after",
      "activate_only_every",
      "dont_activate_after_match",
      "exclude_keys",
      "exclude_keys_all",
      "is_greeting",
      "keep_activate_after_match",
    ]);
  });
});

describe("isGreetingPredicate", () => {
  test("missing arg → keep (no-op)", () => {
    const r = isGreetingPredicate([], ctx({ messages: [] }));
    expect(r.keep).toBe(true);
  });

  test("non-numeric arg → keep (no-op)", () => {
    const r = isGreetingPredicate(["abc"], ctx({ messages: [] }));
    expect(r.keep).toBe(true);
  });

  test("authoritative is_greeting=true + matching greeting_index=0 → keep", () => {
    const r = isGreetingPredicate(["0"], ctx({
      messages: [{ role: "assistant", content: "hi", is_greeting: true, greeting_index: 0 }],
    }));
    expect(r.keep).toBe(true);
  });

  test("authoritative is_greeting=true + greeting_index=1, want=1 (first alternate) → keep", () => {
    const r = isGreetingPredicate(["1"], ctx({
      messages: [{ role: "assistant", content: "hi", is_greeting: true, greeting_index: 1 }],
    }));
    expect(r.keep).toBe(true);
  });

  test("authoritative is_greeting=true + greeting_index=2, want=1 → drop", () => {
    const r = isGreetingPredicate(["1"], ctx({
      messages: [{ role: "assistant", content: "hi", is_greeting: true, greeting_index: 2 }],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("greeting_index=2!=1");
  });

  test("no greeting present → drop with no_greeting", () => {
    const r = isGreetingPredicate(["0"], ctx({
      messages: [{ role: "user", content: "hi", is_greeting: false }],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("is_greeting:no_greeting");
  });
});

describe("activateOnlyAfterPredicate", () => {
  test("missing arg → keep", () => {
    expect(activateOnlyAfterPredicate([], ctx()).keep).toBe(true);
  });

  test("chat shorter than min → drop", () => {
    const r = activateOnlyAfterPredicate(["3"], ctx({
      messages: [
        { role: "assistant", content: "g" },
        { role: "user", content: "u1" },
      ],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("1<3");
  });

  test("chat at min → keep", () => {
    const r = activateOnlyAfterPredicate(["2"], ctx({
      messages: [
        { role: "assistant", content: "g" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
      ],
    }));
    expect(r.keep).toBe(true);
  });
});

describe("activateOnlyEveryPredicate", () => {
  test("Risu-frame chat length 0 % anything === 0 → keep on greeting-only", () => {
    expect(activateOnlyEveryPredicate(["3"], ctx({
      messages: [{ role: "assistant", content: "g" }],
    })).keep).toBe(true);
  });

  test("len=2, every=3 → drop", () => {
    const r = activateOnlyEveryPredicate(["3"], ctx({
      messages: [
        { role: "assistant", content: "g" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
      ],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("2%3!=0");
  });

  test("zero or negative every → no-op (keep)", () => {
    expect(activateOnlyEveryPredicate(["0"], ctx({ messages: [{ role: "user", content: "u" }] })).keep).toBe(true);
    expect(activateOnlyEveryPredicate(["-1"], ctx({ messages: [{ role: "user", content: "u" }] })).keep).toBe(true);
  });
});

describe("dontActivateAfterMatchPredicate", () => {
  test("no sticky var → keep", () => {
    const r = dontActivateAfterMatchPredicate([], ctx(), "entry-1");
    expect(r.keep).toBe(true);
  });

  test("sticky '1' on the right key → drop", () => {
    const r = dontActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_da_entry1: "1" } },
    }), "entry1");
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("dont_activate_after_match:sticky");
  });

  test("sticky 'true' literal (Risu's write format) → drop", () => {
    const r = dontActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_da_abc: "true" } },
    }), "abc");
    expect(r.keep).toBe(false);
  });

  test("sticky on a DIFFERENT id → keep", () => {
    const r = dontActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_da_other: "1" } },
    }), "entry1");
    expect(r.keep).toBe(true);
  });
});

describe("keepActivateAfterMatchPredicate (READ side)", () => {
  test("no sticky var → keep without force", () => {
    const r = keepActivateAfterMatchPredicate([], ctx(), "entry1");
    expect(r.keep).toBe(true);
    expect(r.force).toBeUndefined();
  });

  test("sticky '1' set → keep + force=true", () => {
    const r = keepActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_ka_abc: "1" } },
    }), "abc");
    expect(r.keep).toBe(true);
    expect(r.force).toBe(true);
    expect(r.reason).toContain("keep_activate_after_match:sticky");
  });

  test("sticky 'true' (Risu literal) → force", () => {
    const r = keepActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_ka_xyz: "true" } },
    }), "xyz");
    expect(r.force).toBe(true);
  });

  test("KA sticky on entry A does not force entry B", () => {
    const r = keepActivateAfterMatchPredicate([], ctx({
      chatMetadata: { chat_variables: { __internal_ka_a: "1" } },
    }), "b");
    expect(r.force).toBeUndefined();
  });
});

describe("excludeKeysPredicate", () => {
  test("no args → keep (no-op)", () => {
    expect(excludeKeysPredicate([], ctx({ messages: [{ role: "user", content: "spoiler" }] })).keep).toBe(true);
  });

  test("ANY key match in last 4 messages → drop", () => {
    const r = excludeKeysPredicate(["spoiler", "secret"], ctx({
      messages: [
        { role: "user", content: "the spoiler reveal is..." },
      ],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("exclude_keys:matched");
  });

  test("case-insensitive matching", () => {
    const r = excludeKeysPredicate(["SPOILER"], ctx({
      messages: [{ role: "user", content: "the spoiler reveal" }],
    }));
    expect(r.keep).toBe(false);
  });

  test("whitespace-stripped matching (Risu :207 — 'real key' replace)", () => {
    const r = excludeKeysPredicate(["spoiler reveal"], ctx({
      messages: [{ role: "user", content: "the spoilerreveal is here" }],
    }));
    // Risu strips spaces from BOTH the haystack and the needle, so
    // "spoiler reveal" matches "spoilerreveal".
    expect(r.keep).toBe(false);
  });

  test("no match → keep", () => {
    const r = excludeKeysPredicate(["spoiler"], ctx({
      messages: [{ role: "user", content: "completely unrelated" }],
    }));
    expect(r.keep).toBe(true);
  });

  test("scan window respects defaultScanDepth — only last N msgs scanned", () => {
    const r = excludeKeysPredicate(["spoiler"], ctx({
      // Only the last 2 messages should be scanned with depth=2.
      // The "spoiler" mention in msg[0] is outside the window.
      defaultScanDepth: 2,
      messages: [
        { role: "user", content: "spoiler is in here" },   // msg 0 — outside window
        { role: "assistant", content: "ok" },                // msg 1 — inside
        { role: "user", content: "ok" },                     // msg 2 — inside
      ],
    }));
    expect(r.keep).toBe(true);
  });

  test("null defaultScanDepth scans every non-greeting message", () => {
    const r = excludeKeysPredicate(["spoiler"], ctx({
      defaultScanDepth: null,
      messages: [
        { role: "user", content: "spoiler is in here" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "ok" },
      ],
    }));
    expect(r.keep).toBe(false);
  });
});

describe("excludeKeysAllPredicate", () => {
  test("ALL keys must match somewhere", () => {
    const r = excludeKeysAllPredicate(["spoiler", "secret"], ctx({
      messages: [
        { role: "user", content: "spoiler is here" },
        { role: "assistant", content: "the secret is..." },
      ],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("exclude_keys_all:all_matched");
  });

  test("ANY key missing → keep", () => {
    const r = excludeKeysAllPredicate(["spoiler", "secret"], ctx({
      messages: [
        { role: "user", content: "only spoiler is mentioned" },
      ],
    }));
    expect(r.keep).toBe(true);
  });

  test("no args → keep", () => {
    expect(excludeKeysAllPredicate([], ctx()).keep).toBe(true);
  });

  test("single key behaves like exclude_keys (since 'all' of one key reduces to 'any')", () => {
    const r = excludeKeysAllPredicate(["spoiler"], ctx({
      messages: [{ role: "user", content: "spoiler is here" }],
    }));
    expect(r.keep).toBe(false);
  });
});

describe("entryMatchedScanWindow", () => {
  test("primary key match → true", () => {
    const e = entry({ key: ["dragon"] });
    expect(entryMatchedScanWindow(e, ctx({
      messages: [{ role: "user", content: "the dragon attacks" }],
    }))).toBe(true);
  });

  test("secondary key match → true", () => {
    const e = entry({ key: [], keysecondary: ["serpent"] });
    expect(entryMatchedScanWindow(e, ctx({
      messages: [{ role: "user", content: "a serpent appeared" }],
    }))).toBe(true);
  });

  test("no keys → false", () => {
    expect(entryMatchedScanWindow(entry(), ctx({
      messages: [{ role: "user", content: "anything" }],
    }))).toBe(false);
  });

  test("scan window limits visibility", () => {
    const e = entry({ key: ["spoiler"] });
    expect(entryMatchedScanWindow(e, ctx({
      defaultScanDepth: 1,
      messages: [
        { role: "user", content: "spoiler" },          // outside window
        { role: "assistant", content: "ok" },           // inside
      ],
    }))).toBe(false);
  });
});

describe("evaluatePreActivationGates — multi-decorator entries", () => {
  test("first failing gate short-circuits", () => {
    const e = entry({
      extensions: {
        _risu_decorators: [
          { name: "activate_only_after", args: ["10"] },
          { name: "is_greeting", args: ["0"] },
        ],
      },
    });
    const r = evaluatePreActivationGates(e, ctx({
      messages: [{ role: "assistant", content: "hi" }],
    }));
    expect(r.keep).toBe(false);
    expect(r.reason).toContain("activate_only_after");
  });

  test("force vote propagates when no other gate fails", () => {
    const e = entry({
      id: "abc",
      extensions: {
        _risu_decorators: [
          { name: "keep_activate_after_match", args: [] },
        ],
      },
    });
    const r = evaluatePreActivationGates(e, ctx({
      chatMetadata: { chat_variables: { __internal_ka_abc: "1" } },
    }));
    expect(r.keep).toBe(true);
    expect(r.force).toBe(true);
  });

  test("disable beats force — failing gate cancels the force vote", () => {
    const e = entry({
      id: "abc",
      extensions: {
        _risu_decorators: [
          { name: "keep_activate_after_match", args: [] },
          { name: "is_greeting", args: ["0"] },
        ],
      },
    });
    const r = evaluatePreActivationGates(e, ctx({
      chatMetadata: { chat_variables: { __internal_ka_abc: "1" } },
      messages: [{ role: "user", content: "hi" }],
    }));
    expect(r.keep).toBe(false);
  });

  test("Tier-1 stash markers ignored — only Tier-2 gates fire", () => {
    const e = entry({
      extensions: {
        _risu_decorators: [
          { name: "_risu_reverse_depth_note", args: ["..."] },
          { name: "is_greeting", args: ["0"] },
        ],
      },
    });
    const r = evaluatePreActivationGates(e, ctx({
      messages: [{ role: "assistant", content: "hi" }],
    }));
    expect(r.keep).toBe(true);
  });
});

describe("runWorldInfoInterceptor — full chain", () => {
  test("empty entries → empty result arrays", () => {
    const r = runWorldInfoInterceptor(ctx());
    expect(r.disabled).toEqual([]);
    expect(r.forced).toEqual([]);
    expect(r.stickyWrites).toEqual([]);
  });

  test("entries without decorators are unaffected", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [entry({ id: "e1" }), entry({ id: "e2" })],
    }));
    expect(r.disabled).toEqual([]);
    expect(r.forced).toEqual([]);
  });

  test("entry already disabled is recorded but not re-evaluated", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [entry({ id: "e1", disabled: true })],
    }));
    expect(r.disabled).toEqual([]);
    expect(r.perEntry[0]?.reason).toBe("already_disabled");
  });

  test("forced array populated when keep_activate_after_match sticky is set", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "abc",
          extensions: {
            _risu_decorators: [{ name: "keep_activate_after_match", args: [] }],
          },
        }),
      ],
      chatMetadata: { chat_variables: { __internal_ka_abc: "1" } },
    }));
    expect(r.forced).toEqual(["abc"]);
    expect(r.disabled).toEqual([]);
  });

  test("exclude_keys disables when message contains key", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "no-spoilers",
          extensions: {
            _risu_decorators: [{ name: "exclude_keys", args: ["spoiler"] }],
          },
        }),
      ],
      messages: [{ role: "user", content: "the spoiler is" }],
    }));
    expect(r.disabled).toEqual(["no-spoilers"]);
    expect(r.reasons["exclude_keys"]).toBe(1);
  });

  test("sticky writes computed when KA-decorated entry's keys match window", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "dragon-lore",
          key: ["dragon"],
          extensions: {
            _risu_decorators: [{ name: "keep_activate_after_match", args: [] }],
          },
        }),
      ],
      messages: [
        { role: "user", content: "a dragon flew overhead" },
      ],
    }));
    expect(r.stickyWrites).toHaveLength(1);
    expect(r.stickyWrites[0]).toEqual({
      entryId: "dragon-lore",
      varName: "__internal_ka_dragon-lore",
      value: "1",
    });
  });

  test("sticky writes idempotent — if var already set, no write requested", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "dragon-lore",
          key: ["dragon"],
          extensions: {
            _risu_decorators: [{ name: "keep_activate_after_match", args: [] }],
          },
        }),
      ],
      messages: [
        { role: "user", content: "a dragon flew overhead" },
      ],
      chatMetadata: { chat_variables: { "__internal_ka_dragon-lore": "1" } },
    }));
    expect(r.stickyWrites).toEqual([]);
    // The forced vote still fires (read-side sees sticky).
    expect(r.forced).toEqual(["dragon-lore"]);
  });

  test("sticky writes fire for both ka_ and da_ when both decorators present", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "trap-lore",
          key: ["trap"],
          extensions: {
            _risu_decorators: [
              { name: "keep_activate_after_match", args: [] },
              { name: "dont_activate_after_match", args: [] },
            ],
          },
        }),
      ],
      messages: [{ role: "user", content: "stepped on a trap" }],
    }));
    const varNames = r.stickyWrites.map((w) => w.varName).sort();
    expect(varNames).toEqual([
      "__internal_da_trap-lore",
      "__internal_ka_trap-lore",
    ]);
  });

  test("sticky write skipped when entry's keys don't match the window", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "dragon-lore",
          key: ["dragon"],
          extensions: {
            _risu_decorators: [{ name: "keep_activate_after_match", args: [] }],
          },
        }),
      ],
      messages: [{ role: "user", content: "talking about cats" }],
    }));
    expect(r.stickyWrites).toEqual([]);
  });

  test("reasons map aggregates by decorator name", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "a",
          extensions: { _risu_decorators: [{ name: "is_greeting", args: ["0"] }] },
        }),
        entry({
          id: "b",
          extensions: { _risu_decorators: [{ name: "is_greeting", args: ["0"] }] },
        }),
        entry({
          id: "c",
          extensions: { _risu_decorators: [{ name: "activate_only_after", args: ["10"] }] },
        }),
        entry({
          id: "d",
          extensions: { _risu_decorators: [{ name: "exclude_keys", args: ["spoiler"] }] },
        }),
      ],
      messages: [
        { role: "user", content: "spoiler" },
      ],
    }));
    expect([...r.disabled].sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.reasons).toEqual({
      is_greeting: 2,
      activate_only_after: 1,
      exclude_keys: 1,
    });
  });
});

// ─── Tier 3 ──────────────────────────────────────────────────────────────────

describe("parseInjectPlan", () => {
  test("no inject decorators → null", () => {
    expect(parseInjectPlan([{ name: "is_greeting", args: ["0"] }])).toBeNull();
  });

  test("inject_lore <name> alone → append + lore=true (Risu :390 default)", () => {
    expect(parseInjectPlan([{ name: "inject_lore", args: ["target_comment"] }]))
      .toEqual({ operation: "append", location: "target_comment", param: "", lore: true });
  });

  test("inject_at <loc> alone → append + lore=false", () => {
    expect(parseInjectPlan([{ name: "inject_at", args: ["description"] }]))
      .toEqual({ operation: "append", location: "description", param: "", lore: false });
  });

  test("multi-arg location is joined with space (Risu :397 arg.join(' '))", () => {
    expect(parseInjectPlan([{ name: "inject_lore", args: ["foo", "bar"] }])?.location)
      .toBe("foo bar");
  });

  test("inject_replace standalone → replace + lore=false (Risu :412 default init)", () => {
    expect(parseInjectPlan([{ name: "inject_replace", args: ["search-text"] }]))
      .toEqual({ operation: "replace", location: "", param: "search-text", lore: false });
  });

  test("inject_prepend standalone → prepend + lore=false", () => {
    expect(parseInjectPlan([{ name: "inject_prepend", args: ["search-text"] }]))
      .toEqual({ operation: "prepend", location: "", param: "search-text", lore: false });
  });

  test("inject_at then inject_replace → replace operation, location preserved", () => {
    expect(parseInjectPlan([
      { name: "inject_at", args: ["description"] },
      { name: "inject_replace", args: ["{{slot}}"] },
    ])).toEqual({ operation: "replace", location: "description", param: "{{slot}}", lore: false });
  });

  test("inject_lore then inject_prepend → prepend on lore=true target", () => {
    expect(parseInjectPlan([
      { name: "inject_lore", args: ["target"] },
      { name: "inject_prepend", args: ["param-ignored-for-prepend"] },
    ])).toEqual({ operation: "prepend", location: "target", param: "param-ignored-for-prepend", lore: true });
  });

  test("inject_replace before inject_lore — Risu's `??=` keeps replace operation", () => {
    // Risu source :390-399: `inject ??= {operation: 'append', ...}` means the
    // ??= initializes ONLY if undefined. If a prior inject_replace set the
    // operation to 'replace', the inject_lore call doesn't reset operation.
    expect(parseInjectPlan([
      { name: "inject_replace", args: ["search"] },
      { name: "inject_lore", args: ["target"] },
    ])).toEqual({ operation: "replace", location: "target", param: "search", lore: true });
  });
});

describe("applyInjectMerge", () => {
  test("append: target + space + injector (Risu :641)", () => {
    expect(applyInjectMerge("Hello", "World", "append", "")).toBe("Hello World");
  });

  test("prepend: injector + space + target (Risu :645)", () => {
    expect(applyInjectMerge("World", "Hello", "prepend", "")).toBe("Hello World");
  });

  test("replace: first occurrence only (Risu uses String.replace not replaceAll)", () => {
    expect(applyInjectMerge("foo bar foo baz", "X", "replace", "foo"))
      .toBe("X bar foo baz");
  });

  test("replace with no match → unchanged", () => {
    expect(applyInjectMerge("hello", "X", "replace", "missing")).toBe("hello");
  });

  test("replace empty param matches the very start of the string", () => {
    // String.replace('', X) inserts X at index 0 — JS native behaviour.
    expect(applyInjectMerge("foo", "X", "replace", "")).toBe("Xfoo");
  });
});

describe("readPositionPtName", () => {
  test("@@position pt_FOO → 'FOO'", () => {
    expect(readPositionPtName([{ name: "position", args: ["pt_FOO"] }])).toBe("FOO");
  });

  test("@@position before_desc → null (Tier 1 mapping)", () => {
    expect(readPositionPtName([{ name: "position", args: ["before_desc"] }])).toBeNull();
  });

  test("no position decorator → null", () => {
    expect(readPositionPtName([{ name: "is_greeting", args: ["0"] }])).toBeNull();
  });

  test("multiple decorators — first pt_* wins", () => {
    expect(readPositionPtName([
      { name: "depth", args: ["3"] },
      { name: "position", args: ["pt_FIRST"] },
      { name: "position", args: ["pt_SECOND"] },
    ])).toBe("FIRST");
  });
});

describe("computeInjectAndPositionPlans — inject_lore (entry-to-entry merge)", () => {
  test("injector + target with matching comment → mutated target, disabled injector", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "injector",
        comment: "doesnotmatter",
        priority: 10,
        content: "EXTRA",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target_comment"] }] },
      }),
      entry({
        id: "target",
        comment: "target_comment",
        priority: 5,
        content: "BASE",
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.addDisabled).toEqual(["injector"]);
    expect(r.mutated).toEqual([{ entryId: "target", content: "BASE EXTRA" }]);
    expect(r.injectAt).toEqual([]);
  });

  test("multiple injectors targeting same comment stack in priority desc order", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "injA",
        priority: 100,
        content: "A",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target"] }] },
      }),
      entry({
        id: "injB",
        priority: 50,
        content: "B",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target"] }] },
      }),
      entry({ id: "tgt", comment: "target", priority: 0, content: "BASE" }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    // injA (priority 100) applies first: BASE → BASE A
    // injB (priority 50) next: BASE A → BASE A B
    expect(r.mutated[0]?.content).toBe("BASE A B");
    expect([...r.addDisabled].sort()).toEqual(["injA", "injB"]);
  });

  test("inject_replace + inject_lore stack — operation overrides default append", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "injector",
        priority: 10,
        content: "REPLACEMENT",
        extensions: {
          _risu_decorators: [
            { name: "inject_lore", args: ["target_comment"] },
            { name: "inject_replace", args: ["{{slot}}"] },
          ],
        },
      }),
      entry({ id: "target", comment: "target_comment", priority: 5, content: "before {{slot}} after" }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.mutated[0]?.content).toBe("before REPLACEMENT after");
  });

  test("injector with no matching target → silently dropped + injector disabled", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "injector",
        content: "x",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["nonexistent"] }] },
      }),
      entry({ id: "other", comment: "different", content: "BASE" }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.mutated).toEqual([]);
    expect(r.addDisabled).toEqual(["injector"]);
  });

  test("injector cannot target another injector (target must have plan===null)", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "outer",
        content: "OUTER",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["middle_comment"] }] },
      }),
      entry({
        id: "middle",
        comment: "middle_comment",
        content: "MIDDLE",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["leaf_comment"] }] },
      }),
      entry({ id: "leaf", comment: "leaf_comment", content: "LEAF" }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    // outer would target middle but middle is itself an injector → no merge.
    // middle targets leaf successfully → leaf becomes "LEAF MIDDLE".
    expect(r.mutated).toEqual([{ entryId: "leaf", content: "LEAF MIDDLE" }]);
    expect([...r.addDisabled].sort()).toEqual(["middle", "outer"]);
  });

  test("disabledIds excludes entries from the survivor pool", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "injector",
        content: "EXTRA",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target"] }] },
      }),
      entry({ id: "target", comment: "target", content: "BASE" }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set(["injector"]));
    // injector pre-disabled → no merge runs → no mutations.
    expect(r.mutated).toEqual([]);
    expect(r.addDisabled).toEqual([]);
  });
});

describe("computeInjectAndPositionPlans — inject_at (slot injection plans)", () => {
  test("inject_at <loc> emits a plan + disables the injector", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "inj",
        content: "extra description text",
        extensions: { _risu_decorators: [{ name: "inject_at", args: ["description"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.injectAt).toEqual([{
      entryId: "inj",
      loc: "description",
      operation: "append",
      content: "extra description text",
      param: "",
    }]);
    expect(r.addDisabled).toEqual(["inj"]);
  });

  test("inject_at + inject_replace — emits replace plan with param", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "inj",
        content: "REPLACEMENT",
        extensions: {
          _risu_decorators: [
            { name: "inject_at", args: ["main"] },
            { name: "inject_replace", args: ["{{ORIG}}"] },
          ],
        },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.injectAt[0]).toEqual({
      entryId: "inj",
      loc: "main",
      operation: "replace",
      content: "REPLACEMENT",
      param: "{{ORIG}}",
    });
  });

  test("multi-arg loc joined with space (Risu :397)", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "inj",
        content: "x",
        extensions: { _risu_decorators: [{ name: "inject_at", args: ["author", "note"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.injectAt[0]?.loc).toBe("author note");
  });
});

describe("computeInjectAndPositionPlans — position pt_*", () => {
  test("single pt_<NAME> entry → positionPt[NAME] is its content", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "e1",
        content: "Foo content",
        extensions: { _risu_decorators: [{ name: "position", args: ["pt_FOO"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.positionPt).toEqual([{ name: "FOO", content: "Foo content" }]);
  });

  test("multiple pt_<SAME-NAME> entries joined with newline (Risu :583)", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "a",
        priority: 10,
        content: "First",
        extensions: { _risu_decorators: [{ name: "position", args: ["pt_LIST"] }] },
      }),
      entry({
        id: "b",
        priority: 5,
        content: "Second",
        extensions: { _risu_decorators: [{ name: "position", args: ["pt_LIST"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    expect(r.positionPt).toEqual([{ name: "LIST", content: "First\nSecond" }]);
  });

  test("pt_<NAME> entry excluded when in disabledIds", () => {
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "e1",
        content: "Foo content",
        extensions: { _risu_decorators: [{ name: "position", args: ["pt_FOO"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set(["e1"]));
    expect(r.positionPt).toEqual([]);
  });

  test("pt_<NAME> entry that also has inject_lore is treated as injector — content NOT exposed via positionPt", () => {
    // Risu source: pt_* exposure happens for entries in `lorepmt.actives`,
    // which has injectors filtered out. So if an entry has BOTH pt_* AND
    // inject_lore, it's an injector → not exposed via positionParser.
    // Our impl: classifies as injector (plan !== null), so the pt_FOO entry
    // wouldn't be a target either. We DO still record its pt_* exposure though
    // since `classified` walks all survivors. Document this minor divergence.
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "weird",
        comment: "doesnt-match",
        content: "X",
        extensions: {
          _risu_decorators: [
            { name: "position", args: ["pt_FOO"] },
            { name: "inject_lore", args: ["nonexistent"] },
          ],
        },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    // The entry is an injector (disabled). Our impl still surfaces the
    // pt_FOO content; this slightly diverges from Risu where the entry
    // would be filtered before positionParser scan. Accepted divergence —
    // Risu cards almost never combine these.
    expect(r.positionPt).toEqual([{ name: "FOO", content: "X" }]);
    expect(r.addDisabled).toEqual(["weird"]);
  });

  test("pt_<NAME> on a target entry surfaces POST-mutation content via positionPt (Risu parity)", () => {
    // Risu source: positionParser reads `lorepmt.actives` AFTER the inject_lore
    // mutation pass at lorebook.svelte.ts:622-654. A pt_X entry that was
    // mutated by an injector should expose mutated content through {{position::X}}.
    const entries: WorldInfoEntryView[] = [
      entry({
        id: "tgt",
        comment: "shared",
        priority: 5,
        content: "BASE",
        extensions: { _risu_decorators: [{ name: "position", args: ["pt_FOO"] }] },
      }),
      entry({
        id: "inj",
        priority: 10,
        content: "EXTRA",
        extensions: { _risu_decorators: [{ name: "inject_lore", args: ["shared"] }] },
      }),
    ];
    const r = computeInjectAndPositionPlans(entries, new Set());
    // pt_* entries are disabled from regular injection (Risu's positionParser
    // filters them — only their content surfaces via {{position::FOO}}).
    // So `mutated` is empty for the pt_* target — there's no point mutating
    // an entry that won't appear in the prompt.
    expect(r.mutated).toEqual([]);
    expect(r.addDisabled).toContain("inj");
    expect(r.addDisabled).toContain("tgt");
    // pt_FOO content reflects the merged target.
    expect(r.positionPt).toEqual([{ name: "FOO", content: "BASE EXTRA" }]);
  });
});

describe("runWorldInfoInterceptor — Tier 3 integration", () => {
  test("inject_lore mutation + injector disabled propagate through to outcome", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "injector",
          priority: 10,
          content: "EXTRA",
          extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target"] }] },
        }),
        entry({ id: "target", comment: "target", priority: 5, content: "BASE" }),
      ],
    }));
    expect(r.disabled).toEqual(["injector"]);
    expect(r.mutated).toEqual([{ entryId: "target", content: "BASE EXTRA" }]);
    expect(r.reasons["inject"]).toBe(1);
  });

  test("Tier 2 disable suppresses Tier 3 — disabled entry can't be target", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "inj",
          content: "EXTRA",
          extensions: { _risu_decorators: [{ name: "inject_lore", args: ["target"] }] },
        }),
        entry({
          id: "target",
          comment: "target",
          content: "BASE",
          extensions: { _risu_decorators: [{ name: "is_greeting", args: ["99"] }] },
        }),
      ],
      messages: [{ role: "user", content: "hi" }],
    }));
    // target's is_greeting fails → target disabled → no merge target available.
    expect(r.mutated).toEqual([]);
    expect(r.disabled).toContain("target");
    expect(r.disabled).toContain("inj");  // still gets disabled (it's an injector)
  });

  test("inject_at populates injectAt field; positionPt collected from pt_*", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "inj_a",
          content: "before-desc",
          extensions: { _risu_decorators: [{ name: "inject_at", args: ["description"] }] },
        }),
        entry({
          id: "pt_e",
          content: "anchor content",
          extensions: { _risu_decorators: [{ name: "position", args: ["pt_HEADER"] }] },
        }),
      ],
    }));
    expect(r.injectAt).toEqual([{
      entryId: "inj_a",
      loc: "description",
      operation: "append",
      content: "before-desc",
      param: "",
    }]);
    expect(r.positionPt).toEqual([{ name: "HEADER", content: "anchor content" }]);
    // Both are removed from regular prompt injection: inject_at fires its
    // plan post-assembly, and pt_* entries surface only via {{position::}}.
    expect(r.disabled).toContain("inj_a");
    expect(r.disabled).toContain("pt_e");
  });

  test("Tier 2 + Tier 3 mixed: keep_activate_after_match force vote survives Tier 3", () => {
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "ka_entry",
          content: "x",
          extensions: { _risu_decorators: [{ name: "keep_activate_after_match", args: [] }] },
        }),
      ],
      chatMetadata: { chat_variables: { __internal_ka_ka_entry: "1" } },
    }));
    expect(r.forced).toEqual(["ka_entry"]);
    expect(r.disabled).toEqual([]);
    expect(r.mutated).toEqual([]);
  });
});

describe("runWorldInfoInterceptor — inline decorator fallback", () => {
  test("entry with @@position pt_X in raw content (no _risu_decorators stash) routes to positionPt + disable", () => {
    // Lumi-authored lorebook entries don't carry the translate-time
    // `_risu_decorators` extension stash. The runtime must parse decorators
    // off the raw content string as a fallback so manually-authored entries
    // behave like their .charx-imported counterparts.
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "lumi-authored",
          content: "@@position pt_MOD1\n@@activate\n- TestExtra-Hyun, TestExtra-Min",
          extensions: {}, // no _risu_decorators
        }),
      ],
    }));
    // The pt_MOD1 buffer carries the post-strip body, joined per-NAME.
    expect(r.positionPt).toEqual([
      { name: "MOD1", content: "- TestExtra-Hyun, TestExtra-Min" },
    ]);
    // Entry is disabled from regular WI injection (only its content surfaces
    // via {{position::MOD1}}).
    expect(r.disabled).toContain("lumi-authored");
  });

  test("entry with non-@@position decorators inline gets stripped content emitted as mutated", () => {
    // An entry that's a plain prompt content carrier with `@@activate` /
    // `@@priority N` etc. should have those lines stripped from what Lumi
    // injects.
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "inline",
          content: "@@activate\n@@priority 50\nThe actual lore text.",
          extensions: {},
        }),
      ],
    }));
    // No pt_*, no inject_*, just decorators that affect the entry's metadata.
    // The runtime emits a `mutated` so Lumi shows the stripped content.
    expect(r.mutated).toEqual([
      { entryId: "inline", content: "The actual lore text." },
    ]);
    // Entry stays in normal injection — no disabled vote.
    expect(r.disabled).toEqual([]);
  });

  test("translate-time stash takes precedence over inline parse (no double-parse)", () => {
    // When `_risu_decorators` is populated, the runtime should NOT re-parse
    // inline. This mirrors the current behavior for .charx-imported cards
    // and avoids surprising double effects.
    const r = runWorldInfoInterceptor(ctx({
      entries: [
        entry({
          id: "stashed",
          // Inline content has @@position pt_FOO but stash has @@position pt_BAR.
          // Stash wins.
          content: "@@position pt_FOO\nstashed-body",
          extensions: {
            _risu_decorators: [{ name: "position", args: ["pt_BAR"] }],
          },
        }),
      ],
    }));
    // The stash decides the slot — and content is the original (unstripped)
    // since stash-having entries are assumed already-stripped at translate.
    expect(r.positionPt.map((p) => p.name)).toEqual(["BAR"]);
  });
});

// ─── Tier 3 inject_at apply (post-assembly) ──────────────────────────────────

function plan(overrides: Partial<InjectAtPlan> = {}): InjectAtPlan {
  return {
    entryId: "p1",
    loc: "description",
    operation: "append",
    content: "X",
    param: "",
    ...overrides,
  };
}

function msg(role: "system" | "user" | "assistant", content: string): ApplyInjectAtMessage {
  return { role, content };
}

describe("applyInjectAtToMessages — anchor-present operations (Tier A core)", () => {
  test("append: target gets ' <content>' suffix", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Hello DESC stuff")],
      [plan({ operation: "append", content: "EXTRA" })],
      { description: "DESC" },
    );
    expect(r.messages[0]?.content).toBe("Hello DESC stuff EXTRA");
    expect(r.mutationCount).toBe(1);
    expect(r.synthesizedCount).toBe(0);
    expect(r.fallbackAppendCount).toBe(0);
    expect(r.perPlan[0]).toEqual({ entryId: "p1", outcome: "mutated" });
  });

  test("prepend: target gets '<content> ' prefix", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Hello DESC stuff")],
      [plan({ operation: "prepend", content: "EXTRA" })],
      { description: "DESC" },
    );
    expect(r.messages[0]?.content).toBe("EXTRA Hello DESC stuff");
  });

  test("replace with literal param matching: literal substitution", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Hello DESC stuff")],
      [plan({ operation: "replace", param: "DESC", content: "REPLACEMENT" })],
      { description: "DESC" },
    );
    expect(r.messages[0]?.content).toBe("Hello REPLACEMENT stuff");
  });
});

describe("applyInjectAtToMessages — Tier A: template-marker and empty params", () => {
  test("replace with {{slot}} param → replaces anchor text (slot semantic)", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Persona: ALICE — a wizard")],
      [plan({
        loc: "persona",
        operation: "replace",
        param: "{{slot}}",
        content: "BOB — a knight",
      })],
      { persona: "ALICE — a wizard" },
    );
    expect(r.messages[0]?.content).toBe("Persona: BOB — a knight");
    expect(r.mutationCount).toBe(1);
    expect(r.fallbackAppendCount).toBe(0);
    expect(r.perPlan[0]?.outcome).toBe("mutated");
  });

  test("replace with {{original}} param → also replaces anchor text", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Description: original-text-here")],
      [plan({
        operation: "replace",
        param: "{{original}}",
        content: "new-text",
      })],
      { description: "original-text-here" },
    );
    expect(r.messages[0]?.content).toBe("Description: new-text");
  });

  test("replace with empty param → replaces the resolved slot anchor", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Persona: ALICE")],
      [plan({
        loc: "persona",
        operation: "replace",
        param: "",
        content: "BOB",
      })],
      { persona: "ALICE" },
    );
    expect(r.messages[0]?.content).toBe("Persona: BOB");
  });
});

describe("applyInjectAtToMessages — unknown loc / anchor missing", () => {
  test("unknown loc → synthesizes a labeled system message", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "existing")],
      [plan({ loc: "weirdSlot", operation: "append", content: "EXTRA" })],
      { description: "DESC" },
    );
    expect(r.messages).toEqual([
      msg("system", "existing"),
      msg("system", "[weirdSlot]\nEXTRA"),
    ]);
    expect(r.synthesizedCount).toBe(1);
    expect(r.mutationCount).toBe(0);
    expect(r.perPlan[0]?.outcome).toBe("synthesized:unknown_loc");
  });

  test("unknown loc + prepend op → synthesizes content before its label", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "existing")],
      [plan({ loc: "weirdSlot", operation: "prepend", content: "EXTRA" })],
      {},
    );
    expect(r.messages).toEqual([
      msg("system", "existing"),
      msg("system", "EXTRA\n[weirdSlot]"),
    ]);
    expect(r.perPlan[0]?.outcome).toBe("synthesized:unknown_loc");
  });

  test("unknown loc + replace op → synthesizes the fallback body", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "existing")],
      [plan({ loc: "weirdSlot", operation: "replace", param: "anything", content: "EXTRA" })],
      {},
    );
    expect(r.messages).toEqual([
      msg("system", "existing"),
      msg("system", "[weirdSlot]\nEXTRA"),
    ]);
    expect(r.perPlan[0]?.outcome).toBe("synthesized:unknown_loc");
  });

  test("known loc but anchor missing in messages → synthesizes a labeled fallback", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "completely different content")],
      [plan({ loc: "description", operation: "append", content: "EXTRA" })],
      { description: "expected anchor" },
    );
    expect(r.messages).toEqual([
      msg("system", "completely different content"),
      msg("system", "[description]\nEXTRA"),
    ]);
    expect(r.synthesizedCount).toBe(1);
    expect(r.perPlan[0]?.outcome).toBe("synthesized:anchor_missing");
  });
});

describe("applyInjectAtToMessages — replace literal not found", () => {
  test("replace with literal param NOT in slot text → fallback append", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Persona: ALICE")],
      [plan({
        loc: "persona",
        operation: "replace",
        param: "missing-literal",
        content: "EXTRA",
      })],
      { persona: "ALICE" },
    );
    expect(r.messages[0]?.content).toBe("Persona: ALICE EXTRA");
    expect(r.fallbackAppendCount).toBe(1);
    expect(r.mutationCount).toBe(1);
    expect(r.perPlan[0]?.outcome).toBe("fallback_append");
  });

  test("replace with literal param THAT IS found → mutated, no fallback", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Persona: ALICE the wizard")],
      [plan({
        loc: "persona",
        operation: "replace",
        param: "wizard",
        content: "knight",
      })],
      { persona: "ALICE" },
    );
    expect(r.messages[0]?.content).toBe("Persona: ALICE the knight");
    expect(r.fallbackAppendCount).toBe(0);
    expect(r.perPlan[0]?.outcome).toBe("mutated");
  });
});

describe("applyInjectAtToMessages — multiple plans + anchor isolation", () => {
  test("only system messages are scanned for anchor (user/assistant skipped)", () => {
    const r = applyInjectAtToMessages(
      [
        msg("user", "DESC mentioned by user"),
        msg("assistant", "DESC mentioned by assistant"),
        msg("system", "system has DESC"),
      ],
      [plan({ operation: "append", content: "EXTRA" })],
      { description: "DESC" },
    );
    expect(r.messages[0]?.content).toBe("DESC mentioned by user");
    expect(r.messages[1]?.content).toBe("DESC mentioned by assistant");
    expect(r.messages[2]?.content).toBe("system has DESC EXTRA");
  });

  test("multiple plans targeting different slots all apply", () => {
    const r = applyInjectAtToMessages(
      [
        msg("system", "Description: DESC text"),
        msg("system", "System prompt: SYS text"),
      ],
      [
        plan({ entryId: "a", loc: "description", operation: "append", content: "+a" }),
        plan({ entryId: "b", loc: "main", operation: "append", content: "+b" }),
      ],
      { description: "DESC text", main: "SYS text" },
    );
    expect(r.messages[0]?.content).toBe("Description: DESC text +a");
    expect(r.messages[1]?.content).toBe("System prompt: SYS text +b");
    expect(r.mutationCount).toBe(2);
  });

  test("first-anchor-hit semantic — multiple system messages with same anchor", () => {
    const r = applyInjectAtToMessages(
      [
        msg("system", "system A: DESC"),
        msg("system", "system B: DESC also"),
      ],
      [plan({ operation: "append", content: "EXTRA" })],
      { description: "DESC" },
    );
    // First system message containing the anchor is the target. Second is unchanged.
    expect(r.messages[0]?.content).toBe("system A: DESC EXTRA");
    expect(r.messages[1]?.content).toBe("system B: DESC also");
  });

  test("a later plan synthesizes when an earlier replacement removes its anchor", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Persona: ALICE")],
      [
        plan({
          entryId: "replace",
          loc: "persona",
          operation: "replace",
          param: "{{slot}}",
          content: "BOB",
        }),
        plan({
          entryId: "append",
          loc: "persona",
          operation: "append",
          content: "EXTRA",
        }),
      ],
      { persona: "ALICE" },
    );
    expect(r.messages).toEqual([
      msg("system", "Persona: BOB"),
      msg("system", "[persona]\nEXTRA"),
    ]);
    expect(r.mutationCount).toBe(1);
    expect(r.synthesizedCount).toBe(1);
    expect(r.perPlan).toEqual([
      { entryId: "replace", outcome: "mutated" },
      { entryId: "append", outcome: "synthesized:anchor_missing" },
    ]);
  });

  test("noop perPlan outcome when before === after (e.g. empty content append)", () => {
    const r = applyInjectAtToMessages(
      [msg("system", "Hello DESC stuff")],
      [plan({ operation: "replace", param: "DESC", content: "DESC" })],
      { description: "DESC" },
    );
    // Replace DESC with DESC → no mutation.
    expect(r.mutationCount).toBe(0);
    expect(r.perPlan[0]?.outcome).toBe("noop");
  });
});
