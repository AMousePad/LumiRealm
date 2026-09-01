import { describe, test, expect } from "bun:test";
import {
  buildRisuPayload,
  extractAdditionalAssets,
  extractEmotionImages,
} from "../../src/core/pipeline/risu-payload.js";
import { mapCharacter } from "../../src/core/mappers/character.js";
import { translateFromCharxBundle } from "../../src/core/pipeline/translate.js";

// Translator asset-extraction unit tests. Pairs with the broader asset-macro
// parity chain — anchors the shape contract between translator output and
// the extension's `StoredRisuCard.asset_index` builder. Risu oracle
// citations inline on each case.

describe("extractAdditionalAssets (card.data.assets → RisuAsset[])", () => {
  test("returns [] for empty input", () => {
    expect(extractAdditionalAssets([])).toEqual([]);
  });

  test("picks up x-risu-asset entries with embeded:// uris", () => {
    const out = extractAdditionalAssets([
      {
        type: "x-risu-asset",
        uri: "embeded://assets/other/image/BG_Cafeteria.webp",
        name: "BG_Cafeteria",
        ext: "webp",
      },
      {
        type: "x-risu-asset",
        uri: "embeded://assets/other/image/Char_Asahi_Smile.png",
        name: "Char_Asahi_Smile",
        ext: "png",
      },
    ]);
    expect(out).toEqual([
      {
        name: "BG_Cafeteria",
        path: "assets/other/image/BG_Cafeteria.webp",
        ext: "webp",
      },
      {
        name: "Char_Asahi_Smile",
        path: "assets/other/image/Char_Asahi_Smile.png",
        ext: "png",
      },
    ]);
  });

  test("ignores non-x-risu-asset entries (CCSv3 allows other types)", () => {
    const out = extractAdditionalAssets([
      { type: "other-format", uri: "embeded://assets/x.txt", name: "x" },
      { type: "x-risu-asset", uri: "embeded://assets/y.png", name: "y", ext: "png" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("y");
  });

  test("drops malformed entries missing name or uri", () => {
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "embeded://assets/x.png", ext: "png" }, // no name
      { type: "x-risu-asset", name: "y", ext: "png" }, // no uri
      { type: "x-risu-asset", uri: "embeded://assets/z.png", name: "z", ext: "png" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("z");
  });

  test("derives ext from path when not explicitly set", () => {
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "embeded://assets/foo.jpg", name: "foo" },
      { type: "x-risu-asset", uri: "embeded://assets/bar", name: "bar" }, // no ext anywhere
    ]);
    expect(out[0]!.ext).toBe("jpg");
    expect(out[1]!.ext).toBeUndefined();
  });

  test("explicit ext wins over path-derived", () => {
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "embeded://assets/img.png", name: "x", ext: "WEBP" },
    ]);
    expect(out[0]!.ext).toBe("webp"); // lowercased
  });

  test("passes through uris without embeded:// prefix (uncommon but legal)", () => {
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "assets/plain.png", name: "plain", ext: "png" },
    ]);
    expect(out[0]!.path).toBe("assets/plain.png");
  });

  test("strips __asset:N prefix (Risu PNG-export scheme)", () => {
    // PNG-export cards key assets by chunk index, not zip path.
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "__asset:4", name: "ass_1", ext: "webp" },
      { type: "x-risu-asset", uri: "__asset:543", name: "ass_540", ext: "webp" },
    ]);
    expect(out).toEqual([
      { name: "ass_1", path: "4", ext: "webp" },
      { name: "ass_540", path: "543", ext: "webp" },
    ]);
  });

  test("preserves duplicate-name entries (for srcPaths-style multi-asset names)", () => {
    // Risu's getAssetSrc pushes multiple srcPaths under the same lowercased
    // key (parser.svelte.ts:411-420). We preserve both at the translator
    // layer so the extension can decide how to collapse.
    const out = extractAdditionalAssets([
      { type: "x-risu-asset", uri: "embeded://a.png", name: "same", ext: "png" },
      { type: "x-risu-asset", uri: "embeded://b.png", name: "same", ext: "png" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.path).toBe("a.png");
    expect(out[1]!.path).toBe("b.png");
  });
});

describe("extractEmotionImages (data.extensions.risuai.emotions → RisuAsset[])", () => {
  test("returns [] when emotions is missing or non-array", () => {
    expect(extractEmotionImages({})).toEqual([]);
    expect(extractEmotionImages({ risuai: {} })).toEqual([]);
    expect(extractEmotionImages({ risuai: { emotions: "not-array" } })).toEqual([]);
  });

  test("legacy tuple form [name, src, ext]", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [
          ["happy", "assets/emo/happy.png", "png"],
          ["sad", "assets/emo/sad.webp", "webp"],
        ],
      },
    });
    expect(out).toEqual([
      { name: "happy", path: "assets/emo/happy.png", ext: "png" },
      { name: "sad", path: "assets/emo/sad.webp", ext: "webp" },
    ]);
  });

  test("object form { name, src, ext }", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [{ name: "smile", src: "e/smile.jpg", ext: "jpg" }],
      },
    });
    expect(out).toEqual([
      { name: "smile", path: "e/smile.jpg", ext: "jpg" },
    ]);
  });

  test("accepts `path` as alternate field name for the zip location", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [{ name: "angry", path: "e/angry.png" }],
      },
    });
    expect(out[0]!.path).toBe("e/angry.png");
    expect(out[0]!.ext).toBe("png"); // derived
  });

  test("strips __asset:N prefix in tuple form (PNG-export emotions)", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [
          ["happy", "__asset:0", "png"],
          ["sad", "__asset:1", "webp"],
        ],
      },
    });
    expect(out).toEqual([
      { name: "happy", path: "0", ext: "png" },
      { name: "sad", path: "1", ext: "webp" },
    ]);
  });

  test("strips __asset:N prefix in object form", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [{ name: "smile", src: "__asset:42", ext: "jpg" }],
      },
    });
    expect(out).toEqual([
      { name: "smile", path: "42", ext: "jpg" },
    ]);
  });

  test("skips malformed entries (missing name or src)", () => {
    const out = extractEmotionImages({
      risuai: {
        emotions: [
          ["", "assets/x.png", "png"], // empty name
          ["ok", "", "png"], // empty src
          ["fine", "assets/fine.png", "png"],
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("fine");
  });
});

describe("buildRisuPayload — assets threading", () => {
  const base = {
    translatorVersion: "0.0.0-test",
    risuSpecVersion: "risu-1",
    triggers: [],
    atActions: [],
    requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
  } as const;

  test("payload.additional_assets populated from extracted.assets", () => {
    const payload = buildRisuPayload({
      ...base,
      extracted: {
        characterBook: null,
        backgroundHTML: null,
        customScripts: [],
        triggerScripts: [],
        virtualScript: null,
        defaultVariables: null,
        assets: [
          { type: "x-risu-asset", uri: "embeded://a.png", name: "A", ext: "png" },
        ],
        depthPrompt: null,
        additionalText: null,
        utilityBot: false,
      },
      characterExtensions: {},
    });
    expect(payload.additional_assets).toEqual([
      { name: "A", path: "a.png", ext: "png" },
    ]);
    expect(payload.emotion_images).toEqual([]);
  });

  test("payload.emotion_images populated from characterExtensions.risuai.emotions", () => {
    const payload = buildRisuPayload({
      ...base,
      extracted: {
        characterBook: null,
        backgroundHTML: null,
        customScripts: [],
        triggerScripts: [],
        virtualScript: null,
        defaultVariables: null,
        assets: [],
        depthPrompt: null,
        additionalText: null,
        utilityBot: false,
      },
      characterExtensions: {
        risuai: { emotions: [["happy", "e/happy.png", "png"]] },
      },
    });
    expect(payload.emotion_images).toEqual([
      { name: "happy", path: "e/happy.png", ext: "png" },
    ]);
  });

  test("`emotions` does NOT leak into payload.extra", () => {
    // Keep runtime from seeing two copies of the same data.
    const payload = buildRisuPayload({
      ...base,
      extracted: {
        characterBook: null,
        backgroundHTML: null,
        customScripts: [],
        triggerScripts: [],
        virtualScript: null,
        defaultVariables: null,
        assets: [],
        depthPrompt: null,
        additionalText: null,
        utilityBot: false,
      },
      characterExtensions: {
        risuai: {
          emotions: [["x", "e/x.png", "png"]],
          unknownNewField: "forward-compat",
        },
      },
    });
    expect((payload.extra as Record<string, unknown>).emotions).toBeUndefined();
    expect((payload.extra as Record<string, unknown>).unknownNewField).toBe("forward-compat");
  });
});

describe("mapCharacter — CCSv2 risuai.additionalAssets normalization", () => {
  function v2Card(additionalAssets: unknown[]): unknown {
    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Test",
        description: "",
        extensions: {
          risuai: { additionalAssets },
        },
      },
    };
  }

  test("CCSv2 tuple `[name, src, fileName]` normalized to v3 x-risu-asset shape", () => {
    const m = mapCharacter(v2Card([
      ["BG_Cafeteria", "__asset:0", "BG_Cafeteria.webp"],
      ["Char_Smile", "__asset:1", "Char_Smile.png"],
    ]));
    expect(m.extracted.assets).toEqual([
      { type: "x-risu-asset", name: "BG_Cafeteria", uri: "__asset:0", ext: "webp" },
      { type: "x-risu-asset", name: "Char_Smile", uri: "__asset:1", ext: "png" },
    ]);
  });

  test("CCSv2 tuples flow through extractAdditionalAssets after normalization", () => {
    const m = mapCharacter(v2Card([
      ["asset1", "__asset:5", "asset1.webp"],
    ]));
    expect(extractAdditionalAssets(m.extracted.assets)).toEqual([
      { name: "asset1", path: "5", ext: "webp" },
    ]);
  });

  test("CCSv2 tuples are concatenated with v3 data.assets when both exist", () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          { type: "x-risu-asset", uri: "embeded://v3.png", name: "v3", ext: "png" },
        ],
        extensions: {
          risuai: {
            additionalAssets: [["v2", "__asset:7", "v2.webp"]],
          },
        },
      },
    };
    const m = mapCharacter(card);
    const extracted = extractAdditionalAssets(m.extracted.assets);
    expect(extracted).toEqual([
      { name: "v3", path: "v3.png", ext: "png" },
      { name: "v2", path: "7", ext: "webp" },
    ]);
  });

  test("malformed CCSv2 tuples are skipped, not thrown", () => {
    const m = mapCharacter(v2Card([
      ["", "__asset:0", "name.webp"],
      ["ok", "", "name.webp"],
      ["good", "__asset:1", "good.png"],
      "not-an-array",
      [42, 17],
    ]));
    expect(m.extracted.assets).toHaveLength(1);
    expect((m.extracted.assets[0] as { name: string }).name).toBe("good");
  });

  test("filename without extension yields no derived ext (Risu would write filename verbatim)", () => {
    const m = mapCharacter(v2Card([
      ["plain", "__asset:0", "noextension"],
    ]));
    const a = m.extracted.assets[0] as Record<string, unknown>;
    expect(a.ext).toBeUndefined();
  });
});

describe("translateFromCharxBundle — inline data: URI expansion", () => {
  function makeBundle(card: unknown): Parameters<typeof translateFromCharxBundle>[0] {
    return {
      card,
      cardJsonText: null,
      moduleBytes: null,
      moduleEnvelope: null,
      sidecar: null,
      assets: new Map<string, Uint8Array>(),
      xMeta: new Map<string, unknown>(),
      oversizedEntries: [],
      unsafeEntries: [],
      issues: [],
      isPolyglot: false,
      jpegPreview: null,
    };
  }

  test("data:base64 URI in card.data.assets is decoded into bundle.assets", () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          {
            type: "x-risu-asset",
            uri: "data:image/png;base64,SGVsbG8=",
            name: "embedded",
            ext: "png",
          },
        ],
      },
    };
    const bundle = makeBundle(card);
    translateFromCharxBundle(bundle, { mode: "diagnostic" });
    const writableAssets = bundle.assets as Map<string, Uint8Array>;
    expect(writableAssets.size).toBe(1);
    const [path, bytes] = [...writableAssets][0]!;
    expect(path.startsWith("__data_uri_")).toBe(true);
    expect(new TextDecoder().decode(bytes)).toBe("Hello");
    const rewrittenUri = ((card.data as { assets: Array<{ uri: string }> }).assets[0]!.uri);
    expect(rewrittenUri).toBe(`embeded://${path}`);
  });

  test("data:url-encoded URI (no base64) is also decoded", () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          {
            type: "x-risu-asset",
            uri: "data:text/plain,hello%20world",
            name: "txt",
          },
        ],
      },
    };
    const bundle = makeBundle(card);
    translateFromCharxBundle(bundle, { mode: "diagnostic" });
    const writableAssets = bundle.assets as Map<string, Uint8Array>;
    const bytes = [...writableAssets.values()][0]!;
    expect(new TextDecoder().decode(bytes)).toBe("hello world");
  });

  test("non-data URIs untouched + bundle.assets unchanged", () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          { type: "x-risu-asset", uri: "embeded://existing.png", name: "x", ext: "png" },
          { type: "x-risu-asset", uri: "__asset:5", name: "y", ext: "png" },
          { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
        ],
      },
    };
    const bundle = makeBundle(card);
    translateFromCharxBundle(bundle, { mode: "diagnostic" });
    expect((bundle.assets as Map<string, Uint8Array>).size).toBe(0);
    const uris = (card.data as { assets: Array<{ uri: string }> }).assets.map((a) => a.uri);
    expect(uris).toEqual(["embeded://existing.png", "__asset:5", "ccdefault:"]);
  });

  test("malformed data: URI (no comma) skipped, not thrown", () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          { type: "x-risu-asset", uri: "data:malformed-no-comma", name: "x" },
          { type: "x-risu-asset", uri: "data:text/plain,ok", name: "y" },
        ],
      },
    };
    const bundle = makeBundle(card);
    translateFromCharxBundle(bundle, { mode: "diagnostic" });
    expect((bundle.assets as Map<string, Uint8Array>).size).toBe(1);
    const uris = (card.data as { assets: Array<{ uri: string }> }).assets.map((a) => a.uri);
    expect(uris[0]).toBe("data:malformed-no-comma");
    expect(uris[1]!.startsWith("embeded://__data_uri_")).toBe(true);
  });
});
