import { afterEach, describe, expect, test } from "bun:test";
import {
  lookupRenderMcp,
  cacheRenderMcp,
  invalidateRenderMcpForChat,
  invalidateRenderMcpForMessage,
  resetRenderMcpCache,
  renderMcpCacheStats,
} from "../../src/state/render-mcp-cache";

afterEach(() => {
  resetRenderMcpCache();
});

describe("render-mcp-cache", () => {
  test("miss on empty cache", () => {
    expect(lookupRenderMcp("chatA", "msg1", "hello")).toBeNull();
    expect(renderMcpCacheStats().misses).toBe(1);
    expect(renderMcpCacheStats().hits).toBe(0);
  });

  test("hit on identical (chat,msg,content)", () => {
    cacheRenderMcp("chatA", "msg1", "hello", { kind: "noop" });
    const r = lookupRenderMcp("chatA", "msg1", "hello");
    expect(r).toEqual({ kind: "noop" });
    expect(renderMcpCacheStats().hits).toBe(1);
  });

  test("miss on content-hash mismatch (same key, different content)", () => {
    cacheRenderMcp("chatA", "msg1", "hello", { kind: "noop" });
    expect(lookupRenderMcp("chatA", "msg1", "hello world")).toBeNull();
  });

  test("miss on content-length mismatch (cheap fast-path)", () => {
    cacheRenderMcp("chatA", "msg1", "abc", { kind: "noop" });
    expect(lookupRenderMcp("chatA", "msg1", "abcd")).toBeNull();
  });

  test("transformed result roundtrips", () => {
    cacheRenderMcp("chatA", "msg1", "raw", { kind: "transformed", content: "<div>raw</div>" });
    const r = lookupRenderMcp("chatA", "msg1", "raw");
    expect(r).toEqual({ kind: "transformed", content: "<div>raw</div>" });
  });

  test("idempotent re-feed: prior OUTPUT fed back as input → noop (no double-apply)", () => {
    // display-preprocess: raw → transformed (button appended once)
    cacheRenderMcp("chatA", "msg1", "STORY [Location:x]", {
      kind: "transformed",
      content: "STORY [Location:x]<button>reroll</button>",
    });
    // regex-apply prepass re-invokes render with the prior OUTPUT as input.
    // Must NOT re-run the chain (would append a second button).
    const r = lookupRenderMcp("chatA", "msg1", "STORY [Location:x]<button>reroll</button>");
    expect(r).toEqual({ kind: "noop" });
  });

  test("idempotent guard does not fire for an unrelated different input", () => {
    cacheRenderMcp("chatA", "msg1", "raw", { kind: "transformed", content: "OUT-A" });
    expect(lookupRenderMcp("chatA", "msg1", "totally different body")).toBeNull();
  });

  test("noop-result entry: re-feed of original content still replays noop", () => {
    cacheRenderMcp("chatA", "msg1", "unchanged body", { kind: "noop" });
    expect(lookupRenderMcp("chatA", "msg1", "unchanged body")).toEqual({ kind: "noop" });
  });

  test("re-feed guard survives invalidateRenderMcpForChat (the duplicate-button bug)", () => {
    // display-preprocess: raw STORY -> transformed STORY+button
    cacheRenderMcp("chatA", "msg1", "STORY", { kind: "transformed", content: "STORY<btn>" });
    // A state-changing button click invalidates the chat's result cache...
    invalidateRenderMcpForChat("chatA");
    expect(lookupRenderMcp("chatA", "msg1", "STORY")).toBeNull(); // result cache gone
    // ...but the regex-apply prepass re-feeds the prior OUTPUT. It must still
    // be recognized as already-processed (Risu: editDisplay runs once), else
    // the card's non-idempotent hook appends a second button.
    expect(lookupRenderMcp("chatA", "msg1", "STORY<btn>")).toEqual({ kind: "noop" });
  });

  test("re-feed guard is cleared when the message content actually changes", () => {
    cacheRenderMcp("chatA", "msg1", "STORY", { kind: "transformed", content: "STORY<btn>" });
    invalidateRenderMcpForMessage("chatA", "msg1");
    // Message edited/swiped/deleted: prior outputs no longer describe it.
    expect(lookupRenderMcp("chatA", "msg1", "STORY<btn>")).toBeNull();
  });

  test("re-feed guard tracks the latest output across a var-driven re-render", () => {
    cacheRenderMcp("chatA", "msg1", "STORY", { kind: "transformed", content: "STORY<KO>" });
    invalidateRenderMcpForChat("chatA"); // var change wipes result cache
    // FE re-runs on RAW with new vars -> fresh output recorded.
    cacheRenderMcp("chatA", "msg1", "STORY", { kind: "transformed", content: "STORY<EN>" });
    invalidateRenderMcpForChat("chatA");
    // prepass re-feeds the NEW output -> noop (no double-apply)
    expect(lookupRenderMcp("chatA", "msg1", "STORY<EN>")).toEqual({ kind: "noop" });
    // the OLD output is also still recognized (bounded set), never re-buttoned
    expect(lookupRenderMcp("chatA", "msg1", "STORY<KO>")).toEqual({ kind: "noop" });
    // RAW is NOT an output -> still a miss, so editDisplay re-runs with vars
    expect(lookupRenderMcp("chatA", "msg1", "STORY")).toBeNull();
  });

  test("invalidateRenderMcpForChat drops only that chat's entries", () => {
    cacheRenderMcp("chatA", "msg1", "hi", { kind: "noop" });
    cacheRenderMcp("chatA", "msg2", "ho", { kind: "noop" });
    cacheRenderMcp("chatB", "msg1", "hi", { kind: "noop" });
    invalidateRenderMcpForChat("chatA");
    expect(lookupRenderMcp("chatA", "msg1", "hi")).toBeNull();
    expect(lookupRenderMcp("chatA", "msg2", "ho")).toBeNull();
    expect(lookupRenderMcp("chatB", "msg1", "hi")).toEqual({ kind: "noop" });
  });

  test("invalidateRenderMcpForMessage drops only that one entry", () => {
    cacheRenderMcp("chatA", "msg1", "x", { kind: "noop" });
    cacheRenderMcp("chatA", "msg2", "y", { kind: "noop" });
    invalidateRenderMcpForMessage("chatA", "msg1");
    expect(lookupRenderMcp("chatA", "msg1", "x")).toBeNull();
    expect(lookupRenderMcp("chatA", "msg2", "y")).toEqual({ kind: "noop" });
  });

  test("hit-then-miss on content edit", () => {
    cacheRenderMcp("chatA", "msg1", "v1", { kind: "noop" });
    expect(lookupRenderMcp("chatA", "msg1", "v1")).not.toBeNull();
    expect(lookupRenderMcp("chatA", "msg1", "v2")).toBeNull();
  });

  test("stats track hits + misses across operations", () => {
    cacheRenderMcp("c", "m", "x", { kind: "noop" });
    lookupRenderMcp("c", "m", "x");
    lookupRenderMcp("c", "m", "y");
    lookupRenderMcp("c", "n", "x");
    const s = renderMcpCacheStats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(2);
    expect(s.size).toBe(1);
  });

  test("LRU evicts oldest under MAX_ENTRIES pressure", () => {
    for (let i = 0; i < 600; i++) {
      cacheRenderMcp("chatA", `msg${i}`, `c${i}`, { kind: "noop" });
    }
    expect(renderMcpCacheStats().size).toBeLessThanOrEqual(500);
  });

  test("ts-aged TTL drops entries", async () => {
    cacheRenderMcp("chatA", "msg1", "x", { kind: "noop" });
    expect(lookupRenderMcp("chatA", "msg1", "x")).not.toBeNull();
    const realNow = Date.now;
    Date.now = () => realNow() + 6_000;
    try {
      expect(lookupRenderMcp("chatA", "msg1", "x")).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
