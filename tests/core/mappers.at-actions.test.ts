import { describe, test, expect } from "bun:test";
import { compileAtActions } from "../../src/core/mappers/at-actions.js";
import { mapRegex } from "../../src/core/mappers/regex.js";
import type { CustomScript } from "../../src/core/schemas/customscript.js";

function mk(overrides: Partial<CustomScript> & { type: string; out: string }): CustomScript {
  return { comment: "", in: "x", ...overrides } as CustomScript;
}

function actionsFromScripts(scripts: CustomScript[]) {
  return mapRegex(scripts, { characterId: "C" }).skipped;
}

describe("compileAtActions — file shape", () => {
  test("@@emo emits a trigger file that sets expression", () => {
    const actions = actionsFromScripts([
      mk({ type: "editoutput", in: "hi", out: "@@emo happy" }),
    ]);
    const out = compileAtActions(actions, { characterId: "C" });
    expect(out.files).toHaveLength(1);
    const code = out.files[0]!.code;
    expect(code).toContain("const PATTERN");
    expect(code).toContain("OUT.substring(6)");
    expect(code).toContain("__risu.setExpression");
  });

  test("host-owned move and repeat actions emit no trigger files", () => {
    const move = actionsFromScripts([
      mk({ type: "editoutput", in: "a", out: "@@move_top a" }),
    ]);
    const repeat = actionsFromScripts([
      mk({ type: "editoutput", in: "a", out: "@@repeat_back end" }),
    ]);
    expect(compileAtActions(move, { characterId: "C" }).files).toEqual([]);
    expect(compileAtActions(repeat, { characterId: "C" }).files).toEqual([]);
  });

  test("phase binds to correct Lumiscript event in triggers[]", () => {
    const actions = actionsFromScripts([
      mk({ type: "editdisplay", in: "a", out: "@@emo happy" }),
    ]);
    const out = compileAtActions(actions, { characterId: "C" });
    expect(out.files[0]!.triggers).toEqual(["CHARACTER_MESSAGE_RENDERED"]);
  });

  test("path written under scripts/at-actions/", () => {
    const actions = actionsFromScripts([
      mk({ type: "editoutput", in: "a", out: "@@emo smile", comment: "smile rule" }),
    ]);
    const out = compileAtActions(actions, { characterId: "C" });
    expect(out.files[0]!.path).toMatch(/^scripts\/at-actions\/risu-at-emo-smile_rule\.js$/);
  });

  test("duplicate slugs get numeric suffix", () => {
    const actions = actionsFromScripts([
      mk({ type: "editoutput", in: "a", out: "@@emo x", comment: "dup" }),
      mk({ type: "editoutput", in: "b", out: "@@emo y", comment: "dup" }),
    ]);
    const out = compileAtActions(actions, { characterId: "C" });
    expect(out.files[0]!.path).toContain("dup.js");
    expect(out.files[1]!.path).toContain("dup_2.js");
  });

  test("bindings attached to character scope", () => {
    const actions = actionsFromScripts([
      mk({ type: "editoutput", in: "a", out: "@@emo smile" }),
    ]);
    const out = compileAtActions(actions, { characterId: "CID", characterName: "Alice" });
    expect(out.files[0]!.bindings).toEqual([
      { type: "character", characterId: "CID", displayName: "Alice" },
    ]);
  });
});
