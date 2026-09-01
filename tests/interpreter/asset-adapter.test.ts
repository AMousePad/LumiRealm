import { describe, expect, test } from "bun:test";
import { buildEvaluatorContext } from "../../src/interpreter/evaluator/context.js";
import type { AssetIndexEntry } from "../../src/payload/types.js";

function contextWithAssets(
  additionalAssets: Readonly<Record<string, AssetIndexEntry>> = {},
  emotionImages: Readonly<Record<string, AssetIndexEntry>> = {},
) {
  return buildEvaluatorContext({
    chatId: "asset-test",
    userName: "Dave",
    charName: "Alice",
    character: { additionalAssets, emotionImages },
    chat: { messageCount: 1 },
    variables: {},
    commit: false,
  });
}

describe("buildEvaluatorContext — asset threading", () => {
  test("asset collections default to empty", () => {
    const ctx = contextWithAssets();
    expect(ctx.character.additionalAssets).toEqual([]);
    expect(ctx.character.emotionImages).toEqual([]);
  });

  test("converts every image id to a CharacterAsset", () => {
    const ctx = contextWithAssets({
      rina: { imageIds: ["img-r1", "img-r2", "img-r3"], ext: "png" },
      bg: { imageIds: ["img-bg"], ext: "webp" },
    });

    expect(ctx.character.additionalAssets).toEqual([
      { name: "rina", src: "/api/v1/images/img-r1", ext: "png" },
      { name: "rina", src: "/api/v1/images/img-r2", ext: "png" },
      { name: "rina", src: "/api/v1/images/img-r3", ext: "png" },
      { name: "bg", src: "/api/v1/images/img-bg", ext: "webp" },
    ]);
  });

  test("keeps emotion images in their own namespace", () => {
    const ctx = contextWithAssets(
      { art: { imageIds: ["a1"], ext: "png" } },
      { happy: { imageIds: ["e1"], ext: "png" } },
    );

    expect(ctx.character.additionalAssets).toEqual([
      { name: "art", src: "/api/v1/images/a1", ext: "png" },
    ]);
    expect(ctx.character.emotionImages).toEqual([
      { name: "happy", src: "/api/v1/images/e1", ext: "png" },
    ]);
  });

  test("omits ext when the index entry has none", () => {
    const ctx = contextWithAssets({
      noext: { imageIds: ["img-x"] },
    });

    expect(ctx.character.additionalAssets).toEqual([
      { name: "noext", src: "/api/v1/images/img-x" },
    ]);
  });
});
