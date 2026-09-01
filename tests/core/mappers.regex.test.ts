import { describe, test, expect } from "bun:test";
import { mapRegex } from "../../src/core/mappers/regex.js";
import type { CustomScript } from "../../src/core/schemas/customscript.js";

// Deterministic test doubles.
let uuidCounter = 0;
const fakeUuid = () => `uuid-${++uuidCounter}`;
const fakeNow = () => 1_700_000_000_000;

function reset() {
  uuidCounter = 0;
}

function mk(overrides: Partial<CustomScript> & { type: string }): CustomScript {
  return {
    comment: "",
    in: "x",
    out: "",
    ...overrides,
  } as CustomScript;
}

describe("mapRegex — phase table", () => {
  test("editinput → user_input / prompt", () => {
    reset();
    const r = mapRegex([mk({ type: "editinput", in: "a", out: "b" })], {
      characterId: "C",
      uuid: fakeUuid,
      now: fakeNow,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.placement).toEqual(["user_input"]);
    expect(r.rows[0]!.target).toBe("prompt");
    expect(r.rows[0]!.disabled).toBe(false);
    expect(r.rows[0]!.scope).toBe("character");
    expect(r.rows[0]!.scope_id).toBe("C");
    // editinput only applies to the pending user message — mimic with depth=0.
    expect(r.rows[0]!.max_depth).toBe(0);
  });

  test("editprocess → chat history only / prompt (no world_info)", () => {
    reset();
    const r = mapRegex([mk({ type: "editprocess", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    // Risu's editprocess runs only on the greeting + the chat message loop in
    // prompt assembly, never on world_info / desc / jailbreak / author note.
    expect(r.rows[0]!.placement).toEqual(["user_input", "ai_output"]);
    expect(r.rows[0]!.target).toBe("prompt");
    expect(r.rows[0]!.max_depth).toBeNull();
  });

  test("editoutput → ai_output / response", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.placement).toEqual(["ai_output"]);
    expect(r.rows[0]!.target).toBe("response");
  });

  test("editdisplay → ai_output + user_input / display (Risu role-agnostic parity)", () => {
    reset();
    const r = mapRegex([mk({ type: "editdisplay", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    // Risu's `processScriptFull` applies editdisplay rules to every
    // rendered message regardless of role, with no role-based gating.
    // Lumi's compiler gates strictly by message role, but emitting both
    // placements matches Risu, load-bearing for v2Impersonate-injected
    // user-role messages like a VN-builder card's `[greeting start]` flow.
    expect(r.rows[0]!.placement).toEqual(["ai_output", "user_input"]);
    expect(r.rows[0]!.target).toBe("display");
  });

  test("disabled → ai_output + user_input / display (disabled, but mirrors editdisplay placement for re-enable)", () => {
    reset();
    const r = mapRegex([mk({ type: "disabled", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.placement).toEqual(["ai_output", "user_input"]);
    expect(r.rows[0]!.disabled).toBe(true);
  });

  test("edittrans → disabled display rule (Lumi has no translation pipeline)", () => {
    reset();
    const r = mapRegex([mk({ type: "edittrans", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    // Risu's edittrans runs after machine translation. Lumi has no translation
    // pipeline, so stash it disabled rather than apply it to real prompt text.
    expect(r.rows[0]!.placement).toEqual(["ai_output", "user_input"]);
    expect(r.rows[0]!.target).toBe("display");
    expect(r.rows[0]!.disabled).toBe(true);
  });

  test("disabled → ai_output / display / disabled=true", () => {
    reset();
    const r = mapRegex([mk({ type: "disabled", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.disabled).toBe(true);
  });

  test("unknown type → fallback + issue", () => {
    reset();
    const r = mapRegex([mk({ type: "unheard_of", in: "a", out: "b" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.disabled).toBe(true);
    expect(r.issues[0]!.message).toContain("unknown Risu regex phase");
  });
});

describe("mapRegex — @@action emission", () => {
  // Expression and injection actions need LumiRealm state. Move and repeat
  // actions are represented by one ordinary host row with neutral metadata.
  test("@@emo stashes for runtime, emits no Lumi rows", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "happy", out: "@@emo joy" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.action).toBe("emo");
    expect(r.skipped[0]!.phase).toBe("editoutput");
    expect(r.rows).toHaveLength(0);
  });

  test("@@inject stashes for runtime, emits no Lumi rows", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "state", out: "@@inject" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.action).toBe("inject");
    expect(r.rows).toHaveLength(0);
  });

  test("@@repeat_back emits one neutral repeat row", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "(.+)", out: "@@repeat_back end_nl" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.skipped).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.replace_string).toBe("@@repeat_back end_nl");
    expect(r.rows[0]!.metadata).toMatchObject({
      match_actions: ["repeat_back"],
      repeat_position: "end_nl",
      repeat_raw_match: true,
    });
  });

  test("@@move_top emits one neutral move row", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "(\\[NOTICE\\])", out: "@@move_top $1" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.target).toBe("response");
    expect(r.rows[0]!.replace_string).toBe("$1");
    expect(r.rows[0]!.flags).not.toContain("g");
    expect(r.rows[0]!.substitute_macros).toBe("none");
    expect(r.rows[0]!.metadata).toMatchObject({
      match_actions: ["move_top"],
    });
  });

  test("@@move_bottom and flag repeat preserve both actions", () => {
    const r = mapRegex(
      [mk({
        type: "editoutput",
        in: "(\\[FOOT\\])",
        out: "@@move_bottom $1",
        ableFlag: true,
        flag: "g<repeat_back>",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.metadata).toMatchObject({
      match_actions: ["move_bottom", "repeat_back"],
      repeat_position: "$1",
      repeat_raw_match: true,
    });
  });

  test("metadata._risu.at_action is set on emitted at-action rows", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "x", out: "@@move_top $&" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    for (const row of r.rows) {
      expect((row.metadata as { _risu: { at_action?: string } })._risu.at_action).toBe("move_top");
    }
  });
});

describe("mapRegex — flag normalisation", () => {
  test("ableFlag=false ignores flag → 'g'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "b", flag: "i" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.flags).toBe("g");
  });

  test("ableFlag=true + 'gim' passes through", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "gim" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.flags).toBe("gim");
  });

  test("ableFlag=true + invalid chars stripped", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "zgXi" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.flags).toBe("gi");
  });

  test("ableFlag=true + duplicates deduped", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "gggi" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.flags).toBe("gi");
  });

  test("ableFlag=true + empty after normalisation → 'u'", () => {
    reset();
    // Use chars outside Risu's whitelist "dgimsuvy".
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "abhZ" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.flags).toBe("u");
  });

  test("<order N> meta → negated sort_order so higher order runs first (Risu desc)", () => {
    reset();
    const r = mapRegex(
      [
        mk({ type: "editoutput", in: "c", out: "d" }),
        mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "g<order 5>" }),
      ],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    // Risu sorts by order DESCENDING while Lumi reads sort_order ASC, so the
    // order term is negated. Index tiebreak keeps unflagged rules stable.
    expect(r.rows[0]!.sort_order).toBe(0);
    expect(r.rows[1]!.sort_order).toBe(10 - 500000);
    expect(r.rows[1]!.sort_order).toBeLessThan(r.rows[0]!.sort_order);
    expect(r.rows[1]!.metadata).toMatchObject({ _risu: { order_flag: 5 } });
  });

  // Flag-meta @@-actions also pass through under fd90ddf — no longer routed
  // to skipped[]. The <move_top> token is stripped from the regex flag during
  // normalisation but doesn't change the rule's destination.
  test("<move_top> flag-meta passes through as a regular row", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", ableFlag: true, flag: "g<move_top>" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.skipped).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
  });

  test("<cbs> resolves legacy tokens without resolving the replacement", () => {
    reset();
    const r = mapRegex(
      [mk({
        type: "editdisplay",
        in: "^<USER>$",
        out: "matched",
        ableFlag: true,
        flag: "gi<cbs>",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.substitute_macros).toBe("find");
  });
});

describe("mapRegex — replacement normalisation", () => {
  test("$n → newline", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "line1$nline2" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.replace_string).toBe("line1\nline2");
  });

  test("ending in '>' appends newline (HTML guard)", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "<div>" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.replace_string).toBe("<div>\n");
  });

  test("macro in out, no captures → substitute_macros='escaped'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "hi {{user}}" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("escaped");
  });

  test("macro in out + numbered capture ref → substitute_macros='after'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "(.+)", out: "<img src=\"{{raw::BG_$1}}\">" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("after");
  });

  test("macro in out + named capture ref → substitute_macros='after'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "(?<n>.+)", out: "{{getvar::$<n>}}" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("after");
  });

  test("macro in out + $& full-match ref → substitute_macros='after'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "x", out: "{{lower::$&}}" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("after");
  });

  test("no macro → substitute_macros='none'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "plain text" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("none");
  });

  test("plain capture refs without macros → substitute_macros='none'", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "(.+)", out: "wrap: $1" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("none");
  });

  test("per-message {{chat_index}} gate, no captures → substitute_macros='after'", () => {
    reset();
    const r = mapRegex([mk({
      type: "editdisplay",
      in: "PANEL",
      out: "{{#if {{equal::{{chat_index}}::{{lastmessageid}}}}}}<div class=\"buttons-container\">{{button:: ::Toggle}}</div>{{/if}}",
    })], { characterId: "C", uuid: fakeUuid, now: fakeNow });
    expect(r.rows[0]!.substitute_macros).toBe("after");
  });

  test("{{chatindex}} alias also forces substitute_macros='after'", () => {
    reset();
    const r = mapRegex([mk({ type: "editdisplay", in: "P", out: "{{#if {{equal::{{chatindex}}::0}}}}x{{/if}}" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("after");
  });

  test("non-per-message macro gate stays substitute_macros='escaped'", () => {
    reset();
    const r = mapRegex([mk({ type: "editdisplay", in: "P", out: "{{#if {{equal::{{getvar::lang}}::0}}}}x{{/if}}" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.substitute_macros).toBe("escaped");
  });
});

describe("mapRegex — invalid inputs", () => {
  test("empty `in` AND empty `comment` skipped with issue", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "", out: "x", comment: "" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0]!.message).toContain("empty `in`");
  });
});

describe("mapRegex — divider rules", () => {
  test("empty `in` + non-empty `comment` emits never-match disabled row", () => {
    reset();
    const r = mapRegex([
      mk({ type: "editoutput", in: "/a/", out: "b", comment: "rule A" }),
      mk({ type: "editdisplay", in: "", out: "", comment: "---Future Plan---" }),
      mk({ type: "editoutput", in: "/c/", out: "d", comment: "rule C" }),
    ], { characterId: "C", uuid: fakeUuid, now: fakeNow });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1]!.find_regex).toBe("(?!)");
    expect(r.rows[1]!.disabled).toBe(true);
    expect(r.rows[1]!.name).toBe("---Future Plan---");
    const meta = r.rows[1]!.metadata as { _risu?: { source_type?: string } };
    expect(meta._risu?.source_type).toBe("divider");
    expect(new RegExp(r.rows[1]!.find_regex, r.rows[1]!.flags).test("any text")).toBe(false);
  });
});

describe("mapRegex — comment → name fallback", () => {
  test("row name uses comment when present", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editoutput", in: "a", out: "b", comment: "my rule" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.name).toBe("my rule");
  });

  test("row name synthesised from phase + index when comment empty", () => {
    reset();
    const r = mapRegex([mk({ type: "editoutput", in: "a", out: "b", comment: "" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.name).toMatch(/^risu_response_0$/);
  });
});

describe("mapRegex — display-wrap (portal-only; no auto data-no-island)", () => {
  const STYLED_PANEL =
    `<div class="panel"><style>.panel{color:red}</style><div class="btn">X</div></div>`;

  // Rationale: auto-attaching `data-no-island` to styled replacements
  // opts out of Lumi's extractHtmlIslands shadow wrap, which is also the
  // markdown-bypass mechanism. For arbitrary card content we can't
  // guarantee markdown safety (indented HTML/CSS becomes code blocks),
  // so the translator emits replacements unwrapped and lets Lumi island
  // them naturally. See mappers/regex.ts inline comment.
  test("editdisplay with <style> in replacement → NOT wrapped (lets Lumi island)", () => {
    reset();
    const r = mapRegex([mk({ type: "editdisplay", in: "★", out: STYLED_PANEL })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.replace_string).not.toContain("data-no-island");
  });

  test("editdisplay plain text → no wrap", () => {
    reset();
    const r = mapRegex([mk({ type: "editdisplay", in: "a", out: "plain text" })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.replace_string.startsWith("<div data-")).toBe(false);
  });

  test("non-display phase never wraps", () => {
    reset();
    const r = mapRegex([mk({ type: "editprocess", in: "a", out: STYLED_PANEL })], {
      characterId: "C", uuid: fakeUuid, now: fakeNow,
    });
    expect(r.rows[0]!.replace_string).not.toContain("data-no-island");
    expect(r.rows[0]!.replace_string).not.toContain("data-risu-portal");
  });

});


describe("mapRegex — Risu state-conditional find idiom passes through verbatim", () => {
  test("anchor-first two-branch idiom is preserved (Lumi resolves per-message via dynamicMacros.chat_index)", () => {
    reset();
    const find =
      "{{#if {{not_equal::{{lastmessageid}}::-1}} }}" +
      "$" +
      "{{/if}}" +
      "{{#if {{equal::{{lastmessageid}}::-1}} }}" +
      "★PANEL★" +
      "{{/if}}";
    const r = mapRegex(
      [mk({ type: "editdisplay", in: find, out: "panel" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.find_regex).toBe(find);
  });

  test("literal-first two-branch idiom is preserved", () => {
    reset();
    const find =
      "{{#if {{equal::{{lastmessageid}}::-1}} }}" +
      "★PANEL★" +
      "{{/if}}" +
      "{{#if {{not_equal::{{lastmessageid}}::-1}} }}" +
      "$" +
      "{{/if}}";
    const r = mapRegex(
      [mk({ type: "editdisplay", in: find, out: "panel" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.find_regex).toBe(find);
  });

  test("single-block find passes through untouched", () => {
    reset();
    const find =
      "{{#if {{equal::{{lastmessageid}}::-1}} }}★PANEL★{{/if}}";
    const r = mapRegex(
      [mk({ type: "editdisplay", in: find, out: "panel" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.find_regex).toBe(find);
  });

  test("plain literal find (no CBS) passes through untouched", () => {
    reset();
    const r = mapRegex(
      [mk({ type: "editdisplay", in: "★PANEL★", out: "panel" })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );
    expect(r.rows[0]!.find_regex).toBe("★PANEL★");
  });
});
