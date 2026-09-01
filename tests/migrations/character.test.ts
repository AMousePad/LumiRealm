import { describe, test, expect } from "bun:test";
import {
  migrateCharacterIfNeeded,
  CHARACTER_MIGRATIONS,
  CURRENT_CHARACTER_SCHEMA_VERSION,
  type MigrationDeps,
} from "../../src/migrations/character.js";
import type {
  LumirealmCharacterData,
  StoredRegexScript,
  AssetIndexEntry,
} from "../../src/core/payload/types.js";

// Pinned by the user's broken-PNG-import scenario: a card imported under v4
// (pre-`__asset:` strip / `ccdefault:` / data: URI / CCSv2 fallback fixes)
// stored an empty asset_index. The migration rebuild path must repair the
// index from the captured `source.path_to_image_id` without re-import.

function makeDeps(overrides?: Partial<MigrationDeps>): MigrationDeps {
  return {
    extensionVersion: "0.1.0-test",
    log: { info: () => {}, warn: () => {}, error: () => {} },
    installCharacterRegexScripts: async () => {},
    reinstallAttachedModules: async () => 0,
    dispatchSvgRasterize: () => {},
    writeEnvelope: async () => {},
    getAvatarImageId: async () => null,
    getCharacterWorldBookIds: async () => [],
    listWorldBookEntries: async () => [],
    updateWorldBookEntryExtensions: async () => {},
    updateWorldBookEntryActivation: async () => {},
    applyCharacterRegexReplaceStringTransform: async () => ({ scanned: 1, updated: 0, failed: 0 }),
    applyCharacterRegexRowPatch: async () => ({ scanned: 0, updated: 0, failed: 0 }),
    ...overrides,
  };
}

function makeEnvelope(opts: {
  card: unknown;
  module?: unknown | null;
  pathToImageId: Record<string, string>;
  storedVersion?: number;
  storedAssetIndex?: Record<string, AssetIndexEntry>;
  storedEmotionIndex?: Record<string, AssetIndexEntry>;
}): LumirealmCharacterData {
  return {
    schema_version: 1,
    extension_version: "0.1.0-old",
    translator_version: "0.0.0-test",
    imported_at: 1700000000000,
    payload: {
      triggers: [],
      lua_scripts: [],
      at_actions: [],
      additional_assets: [],
      emotion_images: [],
      background_html: null,
      utility_bot: false,
      scriptstate_defaults: {},
      requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    },
    asset_index: opts.storedAssetIndex ?? {},
    emotion_index: opts.storedEmotionIndex ?? {},
    regex_scripts: [],
    user_overrides: {},
    source: {
      schema_version: 1,
      captured_at: 1700000000000,
      card: opts.card,
      module: opts.module ?? null,
      path_to_image_id: opts.pathToImageId,
    },
    translator_schema_version: opts.storedVersion ?? 4,
  };
}

describe("migrateCharacterIfNeeded — asset_index rebuild", () => {
  test("rebuilds empty asset_index for PNG card with __asset:N URIs (the user's broken-import case)", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Cha Hee-Yeon",
        description: "",
        assets: [
          { type: "icon", name: "iconx", uri: "__asset:0", ext: "png" },
          { type: "x-risu-asset", name: "ass_1", uri: "__asset:5", ext: "webp" },
          { type: "x-risu-asset", name: "ass_2", uri: "__asset:6", ext: "webp" },
          { type: "icon", name: "main", uri: "ccdefault:", ext: "png" },
        ],
      },
    };
    const envelope = makeEnvelope({
      card,
      pathToImageId: {
        "0": "img-icon0",
        "5": "img-ass1",
        "6": "img-ass2",
      },
      storedAssetIndex: {},
    });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    let installedScripts: readonly StoredRegexScript[] | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Cha", userId: "user-1", envelope },
      makeDeps({
        getAvatarImageId: async () => "img-avatar",
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
        installCharacterRegexScripts: async (_id, _name, scripts) => {
          installedScripts = scripts;
        },
      }),
    );
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    expect(result.stepsApplied.map((s) => s.version)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);
    const v5Step = result.stepsApplied.find((s) => s.version === 5)!;
    expect(v5Step.notes.join(' ')).toContain('assets=2');
    expect(writtenEnvelope).not.toBeNull();
    expect(writtenEnvelope!.asset_index).toEqual({
      ass_1: { imageIds: ["img-ass1"], ext: "webp" },
      ass_2: { imageIds: ["img-ass2"], ext: "webp" },
    });
    expect(installedScripts).not.toBeNull();
  });

  test("rebuilt index resolves ccdefault: x-risu-asset entries to avatar imageId", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          { type: "x-risu-asset", name: "default-asset", uri: "ccdefault:", ext: "png" },
        ],
      },
    };
    const envelope = makeEnvelope({ card, pathToImageId: { "any": "x" } });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        getAvatarImageId: async () => "img-avatar",
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
      }),
    );
    expect(result.kind).toBe("migrated");
    expect(writtenEnvelope!.asset_index["default-asset"]).toEqual({
      imageIds: ["img-avatar"],
      ext: "png",
    });
  });

  test("rebuilds index for CCSv2 risuai.additionalAssets tuples", async () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Test",
        description: "",
        extensions: {
          risuai: {
            additionalAssets: [
              ["BG_Cafeteria", "__asset:0", "BG_Cafeteria.webp"],
              ["Char_Smile", "__asset:1", "Char_Smile.png"],
            ],
          },
        },
      },
    };
    const envelope = makeEnvelope({
      card,
      pathToImageId: { "0": "img-bg", "1": "img-smile" },
    });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
      }),
    );
    expect(result.kind).toBe("migrated");
    expect(writtenEnvelope!.asset_index).toEqual({
      BG_Cafeteria: { imageIds: ["img-bg"], ext: "webp" },
      Char_Smile: { imageIds: ["img-smile"], ext: "png" },
    });
  });

  test("rebuilds emotion_index from CCSv3 data.assets[type=emotion]", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          { type: "emotion", name: "happy", uri: "embeded://emo/happy.png", ext: "png" },
          { type: "emotion", name: "sad", uri: "__asset:7", ext: "png" },
        ],
      },
    };
    const envelope = makeEnvelope({
      card,
      pathToImageId: { "emo/happy.png": "img-happy", "7": "img-sad" },
    });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
      }),
    );
    expect(result.kind).toBe("migrated");
    expect(writtenEnvelope!.emotion_index).toEqual({
      happy: { imageIds: ["img-happy"], ext: "png" },
      sad: { imageIds: ["img-sad"], ext: "png" },
    });
  });

  test("noop when stored version is current", async () => {
    const envelope = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
      storedVersion: CURRENT_CHARACTER_SCHEMA_VERSION,
    });
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps(),
    );
    expect(result.kind).toBe("noop");
  });

  test("needs_reimport when source is missing (legacy 0.2.x cards)", async () => {
    const baseEnv = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
    });
    const { source: _drop, ...rest } = baseEnv;
    const envelope = rest as LumirealmCharacterData;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps(),
    );
    expect(result.kind).toBe("needs_reimport");
  });

  test("preserves stored asset_index when path_to_image_id is empty (no source data)", async () => {
    const envelope = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
      storedAssetIndex: {
        existing: { imageIds: ["img-existing"], ext: "png" },
      },
    });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
      }),
    );
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    expect(result.stepsApplied[0]!.notes.join(' ')).toContain('skipped');
    expect(writtenEnvelope!.asset_index).toEqual({
      existing: { imageIds: ["img-existing"], ext: "png" },
    });
  });

  test("survives data: URI in source — preprocessor decodes during retranslation", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [
          {
            type: "x-risu-asset",
            name: "embedded",
            uri: "data:image/png;base64,SGVsbG8=",
            ext: "png",
          },
        ],
      },
    };
    const envelope = makeEnvelope({ card, pathToImageId: { "__data_uri_0": "img-data" } });
    let writtenEnvelope: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => { writtenEnvelope = data; },
      }),
    );
    expect(result.kind).toBe("migrated");
    expect(writtenEnvelope!.asset_index.embedded).toEqual({
      imageIds: ["img-data"],
      ext: "png",
    });
  });
});

describe("character migration v21 — regex folders", () => {
  test("fills only empty CharX and embedded-sidecar folders", async () => {
    const script = (comment: string) => ({
      comment, in: "before", out: "after", type: "editdisplay", flag: "g", ableFlag: true,
    });
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Ada",
        extensions: { risuai: { customScripts: [script("Card rule")] } },
      },
    };
    const module = {
      id: "module-1", name: "Ada Rules", description: "", regex: [script("Module rule")],
    };
    const envelope = makeEnvelope({ card, module, pathToImageId: {}, storedVersion: 20 });
    const patches: Array<Record<string, unknown> | null> = [];
    let patchPass = 0;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Ada", userId: "user-1", envelope },
      makeDeps({
        applyCharacterRegexRowPatch: async (_id, _uid, patch) => {
          patchPass += 1;
          if (patchPass > 1) return { scanned: 0, updated: 0, failed: 0 };
          // Live rows carry array target/placement and parsed-object metadata.
          const row = (folder: string, risu: Record<string, unknown>) => ({
            folder, target: ["display"], placement: ["ai_output"], metadata: { _risu: risu },
          });
          patches.push(patch(row("", { origin: "character" })));
          patches.push(patch(row("", { origin: "module" })));
          patches.push(patch(row("My Folder", { origin: "character" })));
          patches.push(patch(row("", { imported_regex: true })));
          return { scanned: 4, updated: 2, failed: 0 };
        },
      }),
    );

    expect(result.kind).toBe("migrated");
    expect(patches).toEqual([
      { folder: "CharX — Ada" },
      { folder: "CharX — Ada" },
      null,
      null,
    ]);
  });
});

describe("character migration registry — targeted-step contract", () => {
  test("CURRENT_CHARACTER_SCHEMA_VERSION matches max(CHARACTER_MIGRATIONS.version)", () => {
    const max = Math.max(...CHARACTER_MIGRATIONS.map((m) => m.version));
    expect(CURRENT_CHARACTER_SCHEMA_VERSION).toBe(max);
  });

  test("v5 + v6 don't touch modules or SVG; v7 reinstalls regex_scripts", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [{ type: "x-risu-asset", name: "x", uri: "__asset:0", ext: "png" }],
      },
    };
    const envelope = makeEnvelope({ card, pathToImageId: { "0": "img-x" } });
    let regexCalled = false;
    let modulesCalled = false;
    let svgCalled = false;
    await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        installCharacterRegexScripts: async () => { regexCalled = true; },
        reinstallAttachedModules: async () => { modulesCalled = true; return 0; },
        dispatchSvgRasterize: () => { svgCalled = true; },
      }),
    );
    expect(regexCalled).toBe(true);
    expect(modulesCalled).toBe(false);
    expect(svgCalled).toBe(false);
  });

  test("noop when stored version equals CURRENT (no step execution, no envelope writes)", async () => {
    const envelope = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
      storedVersion: CURRENT_CHARACTER_SCHEMA_VERSION,
    });
    let writeCalls = 0;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async () => { writeCalls += 1; },
      }),
    );
    expect(result.kind).toBe("noop");
    expect(writeCalls).toBe(0);
  });

  test("runs corrected greeting migration after rolled-back v14 was persisted", async () => {
    const envelope = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
      storedVersion: 14,
    });
    let writtenVersion = 0;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => {
          writtenVersion = data.translator_schema_version ?? 0;
        },
      }),
    );
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    expect(result.stepsApplied.map((step) => step.version)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(writtenVersion).toBe(25);
  });

  test('v19 uses retry-stable owned ids and preserves regexInstalled aliases', async () => {
    const envelope = makeEnvelope({
      card: { spec: 'chara_card_v3', data: { name: 'Test', description: '' } },
      pathToImageId: {},
      storedVersion: 18,
    });
    const original = {
      name: 'Rule',
      script_id: 'ABCD-1234',
      find_regex: 'x',
      replace_string: 'y',
      flags: 'g',
      placement: ['ai_output'],
      scope: 'character',
      scope_id: 'char-1',
      target: 'display',
      min_depth: null,
      max_depth: null,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: 'none',
      disabled: false,
      sort_order: 0,
      description: '',
      folder: '',
      metadata: { _risu: { origin: 'character' } },
    } as const satisfies StoredRegexScript;
    const input = { ...envelope, regex_scripts: [original] };
    let installed: readonly StoredRegexScript[] = [];
    let written: LumirealmCharacterData | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: 'char-1', characterName: 'Test', userId: 'user-1', envelope: input },
      makeDeps({
        installCharacterRegexScripts: async (_id, _name, scripts) => { installed = scripts; },
        writeEnvelope: async (_id, data) => { written = data; },
      }),
    );
    expect(result.kind).toBe('migrated');
    expect(installed[0]?.script_id).toBe('lr_owned_abcd_1234');
    expect(installed[0]?.metadata?.['imported_script_id']).toBe('abcd_1234');
    expect((written as LumirealmCharacterData | null)?.regex_scripts[0]?.script_id).toBe('lr_owned_abcd_1234');
  });

  test('v20 retries cleanup without prefixing owned ids again', async () => {
    const envelope = makeEnvelope({
      card: { spec: 'chara_card_v3', data: { name: 'Test', description: '' } },
      pathToImageId: {},
      storedVersion: 19,
    });
    const owned = {
      name: 'Rule',
      script_id: 'lr_owned_abcd_1234',
      find_regex: 'x',
      replace_string: 'y',
      flags: 'g',
      placement: ['ai_output'],
      scope: 'character',
      scope_id: 'char-1',
      target: 'display',
      min_depth: null,
      max_depth: null,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: 'none',
      disabled: false,
      sort_order: 0,
      description: '',
      folder: '',
      metadata: { _risu: { origin: 'module' }, imported_script_id: 'abcd_1234' },
    } as const satisfies StoredRegexScript;
    let installed: readonly StoredRegexScript[] = [];
    const result = await migrateCharacterIfNeeded(
      {
        characterId: 'char-1',
        characterName: 'Test',
        userId: 'user-1',
        envelope: { ...envelope, regex_scripts: [owned] },
      },
      makeDeps({
        installCharacterRegexScripts: async (_id, _name, scripts) => { installed = scripts; },
      }),
    );
    expect(result.kind).toBe('migrated');
    expect(installed[0]?.script_id).toBe('lr_owned_abcd_1234');
  });

  test("moves CBS-only character rows to the native find mode", async () => {
    const envelope = makeEnvelope({
      card: { spec: "chara_card_v3", data: { name: "Test", description: "" } },
      pathToImageId: {},
      storedVersion: 16,
    });
    let patchResult: Record<string, unknown> | null = null;
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        applyCharacterRegexRowPatch: async (_characterId, _userId, patch) => {
          const candidate = patch({
            substitute_macros: "none",
            target: ["response"],
            placement: ["ai_output"],
            metadata: { _risu: { flag_actions: ["cbs"] } },
          });
          if (candidate?.['substitute_macros']) patchResult = candidate;
          return { scanned: 1, updated: 1, failed: 0 };
        },
      }),
    );

    expect(result.kind).toBe("migrated");
    expect(patchResult as Record<string, unknown> | null).toEqual({ substitute_macros: "find" });
  });

  test("walker persists envelope after each step (resumability across crashes)", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        assets: [{ type: "x-risu-asset", name: "y", uri: "__asset:1", ext: "png" }],
      },
    };
    const envelope = makeEnvelope({ card, pathToImageId: { "1": "img-y" } });
    const writes: number[] = [];
    await migrateCharacterIfNeeded(
      { characterId: "char-1", characterName: "Test", userId: "user-1", envelope },
      makeDeps({
        writeEnvelope: async (_id, data) => {
          writes.push(data.translator_schema_version ?? 0);
        },
      }),
    );
    // Pinned: writes match the per-step bumps, ending at CURRENT.
    expect(writes[writes.length - 1]).toBe(CURRENT_CHARACTER_SCHEMA_VERSION);
    expect(writes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("migrateCharacterIfNeeded — v6 _risu_array_index backfill", () => {
  function makeCardWithLore(entries: Array<{ comment: string; content: string; insertion_order?: number }>) {
    return {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Test",
        description: "",
        character_book: {
          entries: entries.map((e, i) => ({
            keys: [`k${i}`],
            content: e.content,
            comment: e.comment,
            insertion_order: e.insertion_order ?? 100,
            enabled: true,
          })),
        },
      },
    };
  }

  test("backfills _risu_array_index on entries matched by source-hash", async () => {
    const card = makeCardWithLore([
      { comment: "alpha", content: "alpha-body" },
      { comment: "beta", content: "beta-body" },
      { comment: "gamma", content: "gamma-body" },
    ]);
    const envelope = makeEnvelope({ card, pathToImageId: {}, storedVersion: 5 });

    // Re-translate inline to compute the source hashes the migration will see.
    // This mirrors what the runner does internally so tests don't depend on
    // running the translator twice with different output shapes.
    const { translateFromStoredSource } = await import(
      "../../src/core/pipeline/translate.js"
    );
    const newBundle = translateFromStoredSource(
      { card, module: null },
      {
        sourceId: "test-bundle",
        mode: "full",
        emitPackScripts: false,
      },
    );

    const live = newBundle.worldBookEntries.map((e, i) => ({
      id: `live-${i}`,
      exclude_greeting: false,
      extensions: {
        _risu_source_hash: (e.extensions as Record<string, unknown>)['_risu_source_hash'],
        // Strip _risu_array_index to simulate pre-v6 storage.
      } as Readonly<Record<string, unknown>>,
    }));

    const updates: Array<{ id: string; extensions: Readonly<Record<string, unknown>> }> = [];
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-v6", characterName: "T", userId: "u", envelope },
      makeDeps({
        getCharacterWorldBookIds: async () => ["wb-1"],
        listWorldBookEntries: async () => live,
        updateWorldBookEntryExtensions: async (id, ext) => { updates.push({ id, extensions: ext }); },
      }),
    );

    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    const v6 = result.stepsApplied.find((s) => s.version === 6);
    expect(v6).toBeDefined();
    expect(v6!.notes.join(" ")).toContain("matched=3");
    expect(v6!.notes.join(" ")).toContain("updated=3");
    expect(updates.length).toBe(3);
    for (const u of updates) {
      expect(typeof u.extensions['_risu_array_index']).toBe("number");
      expect(typeof u.extensions['_risu_source_hash']).toBe("string");
    }
    const indices = updates.map((u) => u.extensions['_risu_array_index']).sort();
    expect(indices).toEqual([0, 1, 2]);
  });

  test("skips live entries with no _risu_source_hash (user additions)", async () => {
    const card = makeCardWithLore([{ comment: "a", content: "aa" }]);
    const envelope = makeEnvelope({ card, pathToImageId: {}, storedVersion: 5 });
    const live = [
      {
        id: "user-added",
        exclude_greeting: false,
        extensions: { user_field: "x" } as Readonly<Record<string, unknown>>,
      },
    ];
    const updates: Array<{ id: string }> = [];
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-skip", characterName: "T", userId: "u", envelope },
      makeDeps({
        getCharacterWorldBookIds: async () => ["wb-1"],
        listWorldBookEntries: async () => live,
        updateWorldBookEntryExtensions: async (id) => { updates.push({ id }); },
      }),
    );
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    const v6 = result.stepsApplied.find((s) => s.version === 6);
    expect(v6!.notes.join(" ")).toContain("unmatched=1");
    expect(v6!.notes.join(" ")).toContain("matched=0");
    expect(updates.length).toBe(0);
  });

  test("no-op when stored _risu_array_index already matches source", async () => {
    const card = makeCardWithLore([{ comment: "a", content: "aa" }]);
    const envelope = makeEnvelope({ card, pathToImageId: {}, storedVersion: 5 });
    const { translateFromStoredSource } = await import(
      "../../src/core/pipeline/translate.js"
    );
    const newBundle = translateFromStoredSource(
      { card, module: null },
      {
        sourceId: "test",
        mode: "full",
        emitPackScripts: false,
      },
    );
    const expectedIdx = (newBundle.worldBookEntries[0]!.extensions as Record<string, unknown>)['_risu_array_index'];
    const live = [{
      id: "already-indexed",
      exclude_greeting: false,
      extensions: {
        _risu_source_hash: (newBundle.worldBookEntries[0]!.extensions as Record<string, unknown>)['_risu_source_hash'],
        _risu_array_index: expectedIdx,
      } as Readonly<Record<string, unknown>>,
    }];
    const updates: Array<{ id: string }> = [];
    const result = await migrateCharacterIfNeeded(
      { characterId: "char-noop", characterName: "T", userId: "u", envelope },
      makeDeps({
        getCharacterWorldBookIds: async () => ["wb-1"],
        listWorldBookEntries: async () => live,
        updateWorldBookEntryExtensions: async (id) => { updates.push({ id }); },
      }),
    );
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") throw new Error("not migrated");
    const v6 = result.stepsApplied.find((s) => s.version === 6);
    expect(v6!.notes.join(" ")).toContain("matched=1");
    expect(v6!.notes.join(" ")).toContain("updated=0");
    expect(updates.length).toBe(0);
  });
});
