import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { triggerIdHandler } from "../../src/risu-compat/handlers/trigger-id.js";

/**
 * `{{trigger_id}}` diff-test.
 *
 * Oracle: Risu's handler at `cbs.ts:184-192`, which is
 * effectively `currentTriggerId ?? 'null'`. That one line is our full spec
 * for this macro; each test case below pins a slice of that spec.
 *
 * The handler is context-driven — it reads ctx.triggerId and nothing else —
 * so we drive it with a mock context and assert exact string output.
 */

describe("trigger_id — diff against Risu oracle", () => {
  test("returns literal string 'null' when no trigger has fired", () => {
    const ctx = makeMockContext({ triggerId: null });
    expect(triggerIdHandler(ctx, [], "trigger_id")).toBe("null");
  });

  test("returns the id verbatim when a trigger has fired", () => {
    const ctx = makeMockContext({ triggerId: "btn-start" });
    expect(triggerIdHandler(ctx, [], "trigger_id")).toBe("btn-start");
  });

  test("returns empty id verbatim (not 'null') when id was explicitly set to empty", () => {
    const ctx = makeMockContext({ triggerId: "" });
    // Risu source: `currentTriggerId ?? 'null'`. `??` only coalesces null/undefined
    // — not empty string. So empty-id passes through.
    expect(triggerIdHandler(ctx, [], "trigger_id")).toBe("");
  });

  test("ignores args (handler takes none)", () => {
    const ctx = makeMockContext({ triggerId: "x" });
    expect(triggerIdHandler(ctx, ["ignored", "also_ignored"], "trigger_id::ignored::also_ignored"))
      .toBe("x");
  });
});
