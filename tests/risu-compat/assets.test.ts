import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";
import type { CharacterAsset } from "../../src/core/cbs/index.js";

// Asset-macro handler diff tests. Every case cites
// parser.svelte.ts:495-582 (Risu imageCBS dispatch) for the expected
// return shape.

function get(name: string) {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler;
}

function ctxWithAssets(
  additionalAssets: CharacterAsset[],
  opts: { emotionImages?: CharacterAsset[]; commit?: boolean } = {},
) {
  return makeMockContext({
    character: {
      additionalAssets,
      emotionImages: opts.emotionImages ?? [],
    },
    commit: opts.commit ?? false, // default to display phase for asset-emit tests
  });
}

const CAFETERIA: CharacterAsset = {
  name: "BG_Cafeteria",
  src: "/api/v1/images/img-001",
  ext: "webp",
};
const ASAHI: CharacterAsset = {
  name: "Char_Asahi_Smile",
  src: "/api/v1/images/img-002",
  ext: "png",
};

describe("phase independence (ctx.commit does NOT gate)", () => {
  // Lumi's display-regex `resolveMacrosBatch` path passes `commit: true`
  // by default ([Lumiverse src/routes/macros.routes.ts:200]). An earlier
  // version of this handler family gated HTML emission on commit=true→''
  // to mirror Risu's "strip at prompt stage" behavior; that broke display
  // rendering because `commit` isn't a phase signal in Lumi — it's the
  // side-effect gate. Handlers now return HTML whenever the asset
  // resolves, at both commit=true and commit=false. Leakage of `<img>`
  // into the LLM prompt is acceptable because display-target regex
  // rules (the canonical Risu asset injection pattern) already isolate
  // these macros to the display pipeline.
  test("{{img::known}} returns HTML at commit=true (prompt phase)", () => {
    const ctx = ctxWithAssets([CAFETERIA], { commit: true });
    const out = get("img")(ctx, ["BG_Cafeteria"], "");
    expect(out).toContain("<img");
    expect(out).toContain("/api/v1/images/img-001");
  });
  test("{{img::known}} returns HTML at commit=false (display phase)", () => {
    const ctx = ctxWithAssets([CAFETERIA], { commit: false });
    const out = get("img")(ctx, ["BG_Cafeteria"], "");
    expect(out).toContain("<img");
  });
  test("missing asset still returns '' at both phases", () => {
    const ctx1 = ctxWithAssets([], { commit: true });
    const ctx2 = ctxWithAssets([], { commit: false });
    expect(get("img")(ctx1, ["nope"], "")).toBe("");
    expect(get("img")(ctx2, ["nope"], "")).toBe("");
  });
});

describe("{{path::name}} / raw alias — bare URL", () => {
  test("returns the src URL verbatim", () => {
    expect(get("path")(ctxWithAssets([CAFETERIA]), ["BG_Cafeteria"], ""))
      .toBe("/api/v1/images/img-001");
  });
  test("case-insensitive lookup", () => {
    expect(get("path")(ctxWithAssets([CAFETERIA]), ["bg_cafeteria"], ""))
      .toBe("/api/v1/images/img-001");
    expect(get("path")(ctxWithAssets([CAFETERIA]), ["BG_CAFETERIA"], ""))
      .toBe("/api/v1/images/img-001");
  });
  test("missing name → ''", () => {
    expect(get("path")(ctxWithAssets([CAFETERIA]), ["unknown"], "")).toBe("");
    expect(get("path")(ctxWithAssets([CAFETERIA]), [""], "")).toBe("");
  });
});

describe("{{img::name}} — <img> tag", () => {
  test("wraps matched asset in Risu-shaped <img>", () => {
    const out = get("img")(ctxWithAssets([CAFETERIA]), ["BG_Cafeteria"], "");
    // parser.svelte.ts:558 — `<img src="..." alt="..." style="... "/>`.
    // Our assetWidthString is empty since we don't expose Risu's
    // DBState.db.assetWidth; matches the "no setting" branch.
    expect(out).toBe('<img src="/api/v1/images/img-001" alt="/api/v1/images/img-001" style=" "/>');
  });
  test("missing → ''", () => {
    expect(get("img")(ctxWithAssets([CAFETERIA]), ["nope"], "")).toBe("");
  });
});

describe("{{image::name}} — inlay wrapper", () => {
  test("wraps in <div class=x-risu-risu-inlay-image><img></div>", () => {
    const out = get("image")(ctxWithAssets([CAFETERIA]), ["BG_Cafeteria"], "");
    // Risu's parser at parser.svelte.ts emits `<div class="risu-inlay-image">`,
    // then the parser's class-rewrite pass prefixes every class with
    // `x-risu-`, so the post-rewrite class is `x-risu-risu-inlay-image`.
    // We emit the post-rewrite form directly since we don't go through
    // Risu's parser. No space before `/>`.
    expect(out).toBe(
      '<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/img-001" alt="/api/v1/images/img-001" style=""/></div>\n',
    );
  });
});

describe("{{emotion::name}} — from emotionImages pool", () => {
  const HAPPY: CharacterAsset = { name: "happy", src: "/api/v1/images/e1", ext: "png" };
  test("reads emotionImages, not additionalAssets", () => {
    const ctx = ctxWithAssets([], { emotionImages: [HAPPY] });
    expect(get("emotion")(ctx, ["happy"], ""))
      .toBe('<img src="/api/v1/images/e1" alt="/api/v1/images/e1" style=" "/>');
  });
  test("emotion lookup is isolated from additionalAssets namespace", () => {
    // Same name in additionalAssets shouldn't satisfy emotion.
    const ctx = ctxWithAssets(
      [{ name: "happy", src: "/api/v1/images/wrong" }],
      { emotionImages: [] },
    );
    expect(get("emotion")(ctx, ["happy"], "")).toBe("");
  });
});

describe("{{asset::name}} — image-or-video branching", () => {
  test("image extension → <img>", () => {
    expect(get("asset")(ctxWithAssets([ASAHI]), ["Char_Asahi_Smile"], ""))
      .toBe('<img src="/api/v1/images/img-002" alt="/api/v1/images/img-002" style=" "/>\n');
  });
  test("video extension → <video autoplay muted loop>", () => {
    const clip: CharacterAsset = { name: "clip", src: "/api/v1/images/v1", ext: "mp4" };
    const out = get("asset")(ctxWithAssets([clip]), ["clip"], "");
    // parser.svelte.ts:574 — autoplay+muted+loop (no controls).
    expect(out).toBe('<video muted autoplay loop><source src="/api/v1/images/v1" type="video/mp4"></video>\n');
  });
  test("webm treated as video", () => {
    const clip: CharacterAsset = { name: "c", src: "/u", ext: "webm" };
    const out = get("asset")(ctxWithAssets([clip]), ["c"], "");
    expect(out).toContain("<video");
  });
  test("missing ext → img branch", () => {
    const noext: CharacterAsset = { name: "x", src: "/u" };
    const out = get("asset")(ctxWithAssets([noext]), ["x"], "");
    expect(out).toContain("<img");
  });
});

describe("{{bg::name}} — background panel div", () => {
  test("returns linear-gradient-darken bg wrapper", () => {
    const out = get("bg")(ctxWithAssets([CAFETERIA]), ["BG_Cafeteria"], "");
    // parser.svelte.ts:569. Literal match against Risu's output.
    expect(out).toBe(
      '<div style="width:100%;height:100%;background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url(/api/v1/images/img-001); background-size: cover;"></div>',
    );
  });
});

describe("{{video::name}} — controls+autoplay+loop", () => {
  test("full-featured <video>", () => {
    const clip: CharacterAsset = { name: "v", src: "/u", ext: "mp4" };
    expect(get("video")(ctxWithAssets([clip]), ["v"], ""))
      .toBe('<video controls autoplay loop><source src="/u" type="video/mp4"></video>\n');
  });
});

describe("{{video-img::name}} — autoplay+muted no controls", () => {
  test("silent autoplay <video>", () => {
    const clip: CharacterAsset = { name: "v", src: "/u", ext: "mp4" };
    expect(get("video-img")(ctxWithAssets([clip]), ["v"], ""))
      .toBe('<video muted autoplay loop><source src="/u" type="video/mp4"></video>\n');
  });
});

describe("{{audio::name}} — <audio>", () => {
  test("controls+autoplay+loop", () => {
    const a: CharacterAsset = { name: "tune", src: "/u", ext: "mp3" };
    expect(get("audio")(ctxWithAssets([a]), ["tune"], ""))
      .toBe('<audio controls autoplay loop><source src="/u" type="audio/mpeg"></audio>\n');
  });
});

describe("{{bgm::name}} — Risu-internal control marker", () => {
  test("hidden risu-ctrl div", () => {
    const b: CharacterAsset = { name: "theme", src: "/u", ext: "mp3" };
    expect(get("bgm")(ctxWithAssets([b]), ["theme"], ""))
      .toBe('<div risu-ctrl="bgm___auto___/u" style="display:none;"></div>\n');
  });
});

describe("{{source::char | user}} — avatar URLs", () => {
  test("source::char returns ctx.character.image", () => {
    const ctx = makeMockContext({
      character: { image: "/api/v1/images/img-char-1" },
    });
    expect(get("source")(ctx, ["char"], "")).toBe("/api/v1/images/img-char-1");
  });

  test("source::user returns ctx.identity.personaImage", () => {
    const ctx = makeMockContext({
      identity: { personaImage: "/api/v1/images/img-persona-1" },
    });
    expect(get("source")(ctx, ["user"], "")).toBe("/api/v1/images/img-persona-1");
  });

  test("missing avatars return '' (Risu parity per parser.svelte.ts:587-593)", () => {
    const ctx = makeMockContext();
    expect(get("source")(ctx, ["char"], "")).toBe("");
    expect(get("source")(ctx, ["user"], "")).toBe("");
  });

  test("unknown kind returns ''", () => {
    const ctx = makeMockContext({
      character: { image: "/api/v1/images/img-x" },
      identity: { personaImage: "/api/v1/images/img-y" },
    });
    expect(get("source")(ctx, ["unknown"], "")).toBe("");
    expect(get("source")(ctx, [], "")).toBe("");
  });

  test("case-insensitive kind matching", () => {
    const ctx = makeMockContext({
      character: { image: "/api/v1/images/CC" },
      identity: { personaImage: "/api/v1/images/PP" },
    });
    expect(get("source")(ctx, ["CHAR"], "")).toBe("/api/v1/images/CC");
    expect(get("source")(ctx, ["User"], "")).toBe("/api/v1/images/PP");
  });
});

describe("missing-asset paths return '' (parser.svelte.ts:537)", () => {
  test("every handler with a missing name → ''", () => {
    const ctx = ctxWithAssets([]);
    // `raw` is a catalog alias of `path`; tested indirectly via `path`.
    for (const name of ["path", "img", "image", "asset", "bg", "emotion", "video", "video-img", "audio", "bgm"]) {
      const h = registry.get(name);
      if (!h) throw new Error(`no handler for ${name}`);
      expect(h.handler(ctx, ["unknown"], "")).toBe("");
    }
  });
});

describe("multi-source-per-name pick (Phase 3 — Risu parser.svelte.ts:543-549)", () => {
  // Risu allows multiple `additionalAssets[]` entries to share a logical
  // name. Same lowercased name + same ext → accumulate to `srcPaths[]`.
  // At render time, `pickHashRand(chatID, (chaId||'global')+chatID)`
  // produces a `cx ∈ [0,1)` and `selIndex = floor(cx * srcPaths.length)`.
  //
  // Adapter shape: emit one CharacterAsset per imageId, all sharing the
  // same `name` and `ext`. findAsset collects matches and picks one.
  function makeMulti(name: string): CharacterAsset[] {
    return [
      { name, src: "/api/v1/images/v1", ext: "png" },
      { name, src: "/api/v1/images/v2", ext: "png" },
      { name, src: "/api/v1/images/v3", ext: "png" },
    ];
  }

  test("single-source: returns the only entry (zero-overhead path)", () => {
    const ctx = ctxWithAssets([{ name: "lone", src: "/api/v1/images/sole", ext: "png" }]);
    expect(get("path")(ctx, ["lone"], "")).toBe("/api/v1/images/sole");
  });

  test("multi-source: returns ONE of the entries", () => {
    const ctx = makeMockContext({
      character: { additionalAssets: makeMulti("rina"), chaId: "char-1" },
      currentMessageIndex: 0,
    });
    const out = get("path")(ctx, ["rina"], "");
    expect(["/api/v1/images/v1", "/api/v1/images/v2", "/api/v1/images/v3"]).toContain(out);
  });

  test("multi-source: pick is deterministic for same (chaId, currentMessageIndex)", () => {
    const ctx1 = makeMockContext({
      character: { additionalAssets: makeMulti("rina"), chaId: "char-A" },
      currentMessageIndex: 5,
    });
    const ctx2 = makeMockContext({
      character: { additionalAssets: makeMulti("rina"), chaId: "char-A" },
      currentMessageIndex: 5,
    });
    expect(get("path")(ctx1, ["rina"], "")).toBe(get("path")(ctx2, ["rina"], ""));
  });

  test("multi-source: pick varies across message indices for same character", () => {
    // Across N=12 message indices we expect to hit at least 2 distinct
    // sources (3 sources, ~uniform pick — collision probability over
    // 12 indices is ~3 * (1/3)^12 ≈ 6e-6, statistically safe).
    const seen = new Set<string>();
    for (let i = -1; i < 11; i++) {
      const ctx = makeMockContext({
        character: { additionalAssets: makeMulti("rina"), chaId: "char-Z" },
        currentMessageIndex: i,
      });
      seen.add(get("path")(ctx, ["rina"], ""));
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test("multi-source: chaId='' falls back to 'global' seed-word (Risu parity)", () => {
    // parser.svelte.ts:546 — `cx = pickHashRand(chatID, (char.chaId || 'global') + chatID)`
    // Empty chaId still produces a stable pick — just uses the literal
    // string 'global' as the seed prefix.
    const ctx = makeMockContext({
      character: { additionalAssets: makeMulti("rina"), chaId: "" },
      currentMessageIndex: 3,
    });
    const out = get("path")(ctx, ["rina"], "");
    expect(["/api/v1/images/v1", "/api/v1/images/v2", "/api/v1/images/v3"]).toContain(out);
  });

  test("multi-source: img/image/asset all see the same pick at a given index", () => {
    // The pick is per-call, but the seed is deterministic in
    // (chaId, currentMessageIndex) — so img/image/asset for the SAME
    // name at the SAME chat index resolve to the same source.
    const ctx = makeMockContext({
      character: { additionalAssets: makeMulti("rina"), chaId: "char-K" },
      currentMessageIndex: 7,
    });
    const fromPath = get("path")(ctx, ["rina"], "");
    const fromImg = get("img")(ctx, ["rina"], "");
    const fromImage = get("image")(ctx, ["rina"], "");
    expect(fromImg).toContain(fromPath);
    expect(fromImage).toContain(fromPath);
  });
});
