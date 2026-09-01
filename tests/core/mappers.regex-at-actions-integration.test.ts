import { describe, expect, test } from "bun:test";
import { mapRegex } from "../../src/core/mappers/regex.js";
import {
  applyRegexScriptsCore,
  type RegexCoreScript,
} from "../../src/display/regex-core.js";
import type { CustomScript } from "../../src/core/schemas/customscript.js";
import type { LumiRegexScript } from "../../src/core/lumiverse/types.js";

let uuidCounter = 0;
const fakeUuid = () => `uuid-${++uuidCounter}`;
const fakeNow = () => 1_700_000_000_000;

function reset() {
  uuidCounter = 0;
}

function mk(overrides: Partial<CustomScript> & { type: string }): CustomScript {
  return { comment: "", in: "x", out: "", ...overrides } as CustomScript;
}

function toCore(row: LumiRegexScript): RegexCoreScript {
  const metadata = row.metadata as Record<string, unknown>;
  const rawActions = metadata.match_actions;
  const matchActions = Array.isArray(rawActions)
    ? rawActions.filter(
        (action): action is "move_top" | "move_bottom" | "repeat_back" =>
          action === "move_top"
          || action === "move_bottom"
          || action === "repeat_back",
      )
    : [];
  return {
    find_regex: row.find_regex,
    replace_string: row.replace_string,
    flags: row.flags,
    substitute_macros: row.substitute_macros,
    placement: row.placement,
    target: row.target,
    min_depth: row.min_depth,
    max_depth: row.max_depth,
    trim_strings: row.trim_strings,
    disabled: row.disabled,
    ...(matchActions.length > 0 ? { matchActions } : {}),
    ...(typeof metadata.repeat_position === "string"
      ? { repeatPosition: metadata.repeat_position }
      : {}),
    ...(metadata.repeat_raw_match === true
      ? { repeatRawMatch: true }
      : {}),
  };
}

function applyRows(
  rows: readonly LumiRegexScript[],
  target: string,
  content: string,
  previousContent?: string,
): string {
  return applyRegexScriptsCore(
    content,
    rows.filter((row) => row.target === target).map(toCore),
    {
      placement: "ai_output",
      depth: 0,
      evalTemplate: (text) => text,
      ...(previousContent !== undefined ? { previousContent } : {}),
    },
  );
}

describe("host-owned regex match actions", () => {
  test("@@move_top maps once and moves the replacement", () => {
    reset();
    const mapped = mapRegex(
      [mk({
        type: "editoutput",
        in: "\\[NOTICE\\]",
        out: "@@move_top !! NOTICE !!",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(mapped.rows).toHaveLength(1);
    expect(applyRows(
      mapped.rows,
      "response",
      "header\nbody [NOTICE]\nfooter",
    )).toBe("!! NOTICE !!\nheader\nbody \nfooter");
  });

  test("@@move_bottom moves capture-expanded output", () => {
    reset();
    const mapped = mapRegex(
      [mk({
        type: "editoutput",
        in: "\\[FOOTNOTE: ([^\\]]+)\\]",
        out: "@@move_bottom (note: $1)",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(applyRows(
      mapped.rows,
      "response",
      "see [FOOTNOTE: alpha] for context",
    )).toBe("see  for context\n(note: alpha)");
  });

  test("multiple move rules retain source order", () => {
    reset();
    const mapped = mapRegex(
      [
        mk({ type: "editoutput", in: "\\[A\\]", out: "@@move_top topA" }),
        mk({ type: "editoutput", in: "\\[B\\]", out: "@@move_top topB" }),
      ],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(applyRows(
      mapped.rows,
      "response",
      "x [A] y [B] z",
    )).toBe("topB\ntopA\nx  y  z");
  });

  test("@@repeat_back copies the previous same-role match on no match", () => {
    reset();
    const mapped = mapRegex(
      [mk({
        type: "editdisplay",
        in: "<status>[^<]+</status>",
        out: "@@repeat_back end_nl",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(applyRows(
      mapped.rows,
      "display",
      "new text",
      "old <status>ready</status>",
    )).toBe("new text\n<status>ready</status>");
  });

  test("repeat remains an ordinary replacement when the current text matches", () => {
    reset();
    const mapped = mapRegex(
      [mk({
        type: "editdisplay",
        in: "status",
        out: "@@repeat_back end",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(applyRows(
      mapped.rows,
      "display",
      "status",
      "old status",
    )).toBe("@@repeat_back end");
  });

  test("a move decorator does not change a combined repeat placement token", () => {
    reset();
    const mapped = mapRegex(
      [mk({
        type: "editdisplay",
        in: "\\[X\\]",
        out: "@@move_top $1",
        ableFlag: true,
        flag: "g<repeat_back>",
      })],
      { characterId: "C", uuid: fakeUuid, now: fakeNow },
    );

    expect(applyRows(
      mapped.rows,
      "display",
      "no match",
      "old [X]",
    )).toBe("no match");
  });
});
