import { describe, test, expect } from "bun:test";
import { buildAssetIndexes } from "../../src/payload/import.js";
import type { RisuPayload } from "../../src/payload/types.js";

// Tests for the name-keyed asset index the backend assembles after the
// frontend uploads the zip contents. Storage and `{{assetlist}}` are
// case-preserving, but Risu's in-memory AssetPaths lookup-cache lowercases
// paths, so card authors' `equal`-checks against `{{assetlist}}` entries
// depend on the index preserving author-case (e.g. `<img src=AssetName>`
// expecting `"AssetName.png"` literal in the list).

function payload(
  additional: RisuPayload["additional_assets"],
  emotions: RisuPayload["emotion_images"] = [],
): Pick<RisuPayload, "additional_assets" | "emotion_images"> {
  return { additional_assets: additional, emotion_images: emotions };
}

describe("buildAssetIndexes", () => {
  test("pairs translator metadata paths with upload imageIds (case preserved)", () => {
    const result = buildAssetIndexes(
      payload([
        { name: "BG_Cafeteria", path: "assets/other/image/BG_Cafeteria.webp", ext: "webp" },
        { name: "Char_Asahi_Smile", path: "assets/other/image/Char_Asahi_Smile.png", ext: "png" },
      ]),
      {
        "assets/other/image/BG_Cafeteria.webp": "img-001",
        "assets/other/image/Char_Asahi_Smile.png": "img-002",
      },
    );
    expect(result.assetIndex).toEqual({
      "BG_Cafeteria": { imageIds: ["img-001"], ext: "webp" },
      "Char_Asahi_Smile": { imageIds: ["img-002"], ext: "png" },
    });
    expect(result.emotionIndex).toEqual({});
    expect(result.mappedCount).toBe(2);
  });

  test("ignores upload paths not in additional_assets (extra zip bytes)", () => {
    const result = buildAssetIndexes(
      payload([{ name: "known", path: "a.png", ext: "png" }]),
      {
        "a.png": "img-known",
        "extra-unlisted.png": "img-extra",
      },
    );
    expect(result.assetIndex).toEqual({
      known: { imageIds: ["img-known"], ext: "png" },
    });
    expect(result.mappedCount).toBe(1); // extra is not mapped
  });

  test("drops metadata entries whose path wasn't uploaded (upload failure)", () => {
    const result = buildAssetIndexes(
      payload([
        { name: "ok", path: "a.png", ext: "png" },
        { name: "missing", path: "b.png", ext: "png" },
      ]),
      { "a.png": "img-a" },
    );
    expect(result.assetIndex).toEqual({
      ok: { imageIds: ["img-a"], ext: "png" },
    });
  });

  test("multi-source-per-name accumulates imageIds (Risu parity, Phase 3)", () => {
    // Risu's `getAssetSrc` (parser.svelte.ts:410-420) accumulates
    // matching-ext entries into `srcPaths[]`. Mirror with imageIds[].
    const result = buildAssetIndexes(
      payload([
        { name: "rina", path: "a.png", ext: "png" },
        { name: "rina", path: "b.png", ext: "png" },
        { name: "rina", path: "c.png", ext: "png" },
      ]),
      { "a.png": "img-a", "b.png": "img-b", "c.png": "img-c" },
    );
    expect(result.assetIndex.rina).toEqual({
      imageIds: ["img-a", "img-b", "img-c"],
      ext: "png",
    });
    expect(result.mappedCount).toBe(3);
  });

  test("multi-source: ext-mismatch entries are silently dropped (Risu ext-binding)", () => {
    // Risu only accumulates if `assetPaths[key].ext === asset[2]`
    // (parser.svelte.ts:417). First-seen ext binds the bucket; later
    // mismatches are dropped — preserving this quirk so video/image
    // branching in `{{asset::name}}` matches Risu when authors ship
    // mixed extensions under one logical name.
    const result = buildAssetIndexes(
      payload([
        { name: "mixed", path: "a.png", ext: "png" },
        { name: "mixed", path: "b.mp4", ext: "mp4" }, // dropped — ext mismatch
        { name: "mixed", path: "c.png", ext: "png" },
      ]),
      { "a.png": "img-a", "b.mp4": "img-b", "c.png": "img-c" },
    );
    expect(result.assetIndex.mixed).toEqual({
      imageIds: ["img-a", "img-c"],
      ext: "png",
    });
    expect(result.mappedCount).toBe(2);
  });

  test("preserves author-written case (mixed-case + hyphens + underscores)", () => {
    const result = buildAssetIndexes(
      payload([{ name: "Char_Asahi-Smile", path: "p", ext: "png" }]),
      { p: "img" },
    );
    // Author case preserved; lookup-side handlers (findAsset) do
    // case-insensitive iteration. `{{assetlist}}` returns this verbatim
    // so card-author `equal`-checks against the literal name succeed.
    expect(result.assetIndex["Char_Asahi-Smile"]).toBeDefined();
    expect(result.assetIndex["char_asahi-smile"]).toBeUndefined();
  });

  test("emotion_images go into emotionIndex, not assetIndex", () => {
    const result = buildAssetIndexes(
      payload(
        [{ name: "art", path: "art.png", ext: "png" }],
        [{ name: "happy", path: "emo/happy.png", ext: "png" }],
      ),
      { "art.png": "img-art", "emo/happy.png": "img-happy" },
    );
    expect(result.assetIndex).toEqual({
      art: { imageIds: ["img-art"], ext: "png" },
    });
    expect(result.emotionIndex).toEqual({
      happy: { imageIds: ["img-happy"], ext: "png" },
    });
    expect(result.mappedCount).toBe(2);
  });

  test("emotions are last-wins on duplicate names (Risu getEmoSrc parity)", () => {
    // Risu's `getEmoSrc` (parser.svelte.ts:423-428) always overwrites
    // with `srcPaths:[one]` — emotions don't accumulate. Mirror with
    // last-wins.
    const result = buildAssetIndexes(
      payload(
        [],
        [
          { name: "happy", path: "h1.png", ext: "png" },
          { name: "happy", path: "h2.png", ext: "png" },
        ],
      ),
      { "h1.png": "img-h1", "h2.png": "img-h2" },
    );
    expect(result.emotionIndex.happy).toEqual({
      imageIds: ["img-h2"],
      ext: "png",
    });
  });

  test("ext omitted when metadata has no ext", () => {
    const result = buildAssetIndexes(
      payload([{ name: "noext", path: "binary" }]),
      { binary: "img-bin" },
    );
    expect(result.assetIndex.noext).toEqual({ imageIds: ["img-bin"] });
    expect(result.assetIndex.noext!.ext).toBeUndefined();
  });

  test("empty inputs → empty outputs, not errors", () => {
    expect(buildAssetIndexes(payload([]), {})).toEqual({
      assetIndex: {},
      emotionIndex: {},
      mappedCount: 0,
    });
  });

  test("ccdefault: path resolves to the avatar imageId (Risu CCv3 alias)", () => {
    const result = buildAssetIndexes(
      payload([
        { name: "default", path: "ccdefault:", ext: "png" },
        { name: "other", path: "real-asset.png", ext: "png" },
      ]),
      { "real-asset.png": "img-real" },
      "img-avatar",
    );
    expect(result.assetIndex).toEqual({
      default: { imageIds: ["img-avatar"], ext: "png" },
      other: { imageIds: ["img-real"], ext: "png" },
    });
    expect(result.mappedCount).toBe(2);
  });

  test("ccdefault: drops when no avatar imageId is supplied", () => {
    const result = buildAssetIndexes(
      payload([{ name: "default", path: "ccdefault:", ext: "png" }]),
      {},
    );
    expect(result.assetIndex).toEqual({});
    expect(result.mappedCount).toBe(0);
  });

  test("ccdefault: also resolves emotion entries", () => {
    const result = buildAssetIndexes(
      payload(
        [],
        [{ name: "neutral", path: "ccdefault:", ext: "png" }],
      ),
      {},
      "img-avatar",
    );
    expect(result.emotionIndex.neutral).toEqual({
      imageIds: ["img-avatar"],
      ext: "png",
    });
  });
});
