import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  convertModuleCharxBundle,
  decodeModuleCharx,
  readCharx,
} from "../../src/core/charx/index.js";
import { encodeRisum } from "../../src/core/risum/index.js";
import { risuModuleSchema } from "../../src/core/schemas/module.js";

function buildCharx(
  card: unknown,
  opts: {
    readonly module?: unknown;
    readonly files?: Readonly<Record<string, Uint8Array>>;
  } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "card.json": strToU8(JSON.stringify(card)),
    ...(opts.files ?? {}),
  };
  if (opts.module !== undefined) {
    files["module.risum"] = encodeRisum({ module: opts.module });
  }
  return zipSync(files);
}

function regex(comment: string): Record<string, unknown> {
  return {
    comment,
    in: "x",
    out: "y",
    type: "editdisplay",
    ableFlag: true,
  };
}

function trigger(comment: string): Record<string, unknown> {
  return {
    comment,
    type: "manual",
    conditions: [],
    effect: [{ type: "showAlert", value: comment }],
  };
}

describe("module CharX conversion", () => {
  test("uses embedded empty lore as authoritative and reconstructs module fields", () => {
    const cardRegex = regex("card-regex");
    const moduleRegex = regex("module-regex");
    const cardTrigger = trigger("card-trigger");
    const moduleTrigger = trigger("module-trigger");
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "CharX Module",
        description: "Character description",
        first_mes: "First",
        alternate_greetings: ["Alt one", "Alt two"],
        creator_notes: "Module description",
        post_history_instructions: "PHI is intentionally not converted",
        character_book: {
          entries: [{
            keys: ["card-only"],
            content: "card lore must be suppressed",
            insertion_order: 7,
            constant: true,
          }],
        },
        extensions: {
          moduleNoneImage: true,
          risuai: {
            customScripts: [cardRegex],
            triggerscript: [cardTrigger],
            lowLevelAccess: true,
            backgroundHTML: "<section>background</section>",
            toggles: "?weather|Weather",
          },
        },
        assets: [
          {
            type: "x-risu-asset",
            name: "theme-song",
            uri: "embeded://assets/audio/theme.ogg",
            ext: "ogg",
          },
          {
            type: "icon",
            name: "main",
            uri: "embeded://assets/icon/main.png",
            ext: "png",
          },
        ],
      },
    };
    const bytes = buildCharx(card, {
      module: {
        name: "embedded name is ignored",
        description: "embedded description is ignored",
        id: "embedded-source-id",
        lorebook: [],
        regex: [moduleRegex],
        trigger: [moduleTrigger],
      },
      files: {
        "assets/audio/theme.ogg": new Uint8Array([1, 2, 3, 4]),
        "assets/icon/main.png": new Uint8Array([137, 80, 78, 71]),
      },
    });

    const bundle = readCharx(bytes);
    const cardBefore = structuredClone(bundle.card);
    const decoded = convertModuleCharxBundle(bundle);
    const parsed = risuModuleSchema.parse(decoded.module);

    expect(bundle.card).toEqual(cardBefore);
    expect(parsed.name).toBe("CharX Module");
    expect(parsed.description).toBe("Module description");
    expect(parsed.id).toBe("embedded-source-id");
    expect(parsed.regex?.map((r) => r.comment)).toEqual(["module-regex"]);
    expect(parsed.trigger?.map((t) => t.comment)).toEqual(["module-trigger"]);
    expect(parsed.lowLevelAccess).toBe(true);
    expect(parsed.backgroundEmbedding).toBe("<section>background</section>");
    expect(parsed.customModuleToggle).toBe("?weather|Weather");
    expect(parsed.hideIcon).toBeUndefined();
    expect(parsed.assets).toEqual([["theme-song", "", "ogg"]]);

    expect(parsed.lorebook).toHaveLength(2);
    expect(parsed.lorebook?.some((entry) => entry.content?.includes("card lore") ?? false)).toBe(false);
    expect(parsed.lorebook?.some((entry) => entry.content?.includes("@@indicator phi") ?? false)).toBe(false);
    expect(parsed.lorebook?.[0]?.content).toBe(
      "@@indicator character_desc\n\nCharacter description",
    );
    expect(parsed.lorebook?.[1]?.content).toBe(
      "@@indicator character_first_message\n\n" +
        "<FM>\nFirst\n</FM>\n" +
        "<FM_alt>\nAlt one\n</FM_alt>\n" +
        "<FM_alt>\nAlt two\n</FM_alt>",
    );

    expect(decoded.assets).toHaveLength(1);
    expect([...decoded.assets[0]!]).toEqual([1, 2, 3, 4]);
    expect(decoded.icon?.ext).toBe("png");
    expect([...(decoded.icon?.data ?? [])]).toEqual([137, 80, 78, 71]);
  });

  test("preserves authored Risu lore, regex, and trigger strings verbatim", () => {
    const rawLore = "{{#if::{{getvar::route}}::north}}RAW{{/if}}";
    const rawFind = "{{#if 1}}<raw>{{/if}}";
    const rawReplace = "{{getvar::untouched}}";
    const rawTriggerValue = "{{#when::toggle::route}}north{{/when}}";
    const bytes = buildCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Raw Module",
        creator_notes: "",
        description: "",
        first_mes: "",
        alternate_greetings: [],
        extensions: { risuai: {} },
        assets: [],
      },
    }, {
      module: {
        name: "ignored",
        description: "ignored",
        id: "raw-id",
        lorebook: [{
          key: "raw",
          secondkey: "",
          insertorder: 1,
          comment: "raw",
          content: rawLore,
          mode: "normal",
          alwaysActive: false,
          selective: false,
        }],
        regex: [{
          comment: "raw",
          in: rawFind,
          out: rawReplace,
          type: "editdisplay",
          ableFlag: true,
        }],
        trigger: [{
          comment: "raw",
          type: "manual",
          conditions: [],
          effect: [{ type: "setvar", value: rawTriggerValue }],
        }],
      },
    });

    const parsed = risuModuleSchema.parse(decodeModuleCharx(bytes).module);
    expect(parsed.lorebook?.[0]?.content).toBe(rawLore);
    expect(parsed.regex?.[0]?.in).toBe(rawFind);
    expect(parsed.regex?.[0]?.out).toBe(rawReplace);
    expect(parsed.trigger?.[0]?.effect?.[0]?.value).toBe(rawTriggerValue);
  });

  test("without module.risum uses card regex/triggers and ports charbook decorators", () => {
    const bytes = buildCharx({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Ordinary Card",
        creator_notes: "",
        extensions: {
          risuai: {
            customScripts: [regex("card-regex")],
            triggerscript: [trigger("card-trigger")],
          },
        },
        character_book: {
          entries: [{
            keys: ["alpha", "beta"],
            secondary_keys: ["secondary"],
            content: "body",
            insertion_order: 42,
            case_sensitive: true,
            use_regex: true,
            selective: true,
            extensions: {
              useProbability: true,
              probability: 25,
              delay: 3,
              match_whole_words: false,
              risu_activationPercent: 66,
            },
          }],
        },
      },
    });

    const parsed = risuModuleSchema.parse(decodeModuleCharx(bytes).module);
    expect(parsed.regex?.map((r) => r.comment)).toEqual(["card-regex"]);
    expect(parsed.trigger?.map((t) => t.comment)).toEqual(["card-trigger"]);
    expect(parsed.lorebook).toHaveLength(1);
    expect(parsed.lorebook?.[0]).toMatchObject({
      key: "alpha, beta",
      secondkey: "secondary",
      insertorder: 42,
      useRegex: false,
      activationPercent: 66,
      selective: true,
      content:
        "@@match_partial_word\n" +
        "@@activate_only_after 3\n" +
        "@@probability 25\n" +
        "body",
    });
  });

  test("rejects non-v3 CharX cards", () => {
    const bytes = buildCharx({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Legacy" },
    });
    expect(() => decodeModuleCharx(bytes)).toThrow("chara_card_v3");
  });
});
