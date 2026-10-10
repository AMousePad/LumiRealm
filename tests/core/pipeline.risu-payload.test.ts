/**
 * Step 3 — RisuPayload builder + pipeline-integration tests.
 *
 * The payload is the product-facing handoff to the `risu-compat` extension's
 * interpreter. These tests assert the *shape* of the handoff
 * — every field that downstream code reads must be populated from the right
 * upstream source.
 */

import { describe, test, expect } from "bun:test";
import {
  buildRisuPayload,
  parseScriptstateDefaults,
  extractLuaScripts,
  extractRisuaiExtra,
} from "../../src/core/pipeline/risu-payload.js";
import type { TriggerScript } from "../../src/core/schemas/triggerscript.js";

describe("parseScriptstateDefaults", () => {
  test("parses key=value lines", () => {
    expect(parseScriptstateDefaults("a=1\nb=hello\nc=foo bar")).toEqual({
      a: "1",
      b: "hello",
      c: "foo bar",
    });
  });

  test("handles CRLF + blanks + commented lines", () => {
    const text = "a=1\r\n\r\n# comment\n// also a comment\nb=2\r\n";
    expect(parseScriptstateDefaults(text)).toEqual({ a: "1", b: "2" });
  });

  test("preserves `=` characters inside values", () => {
    expect(parseScriptstateDefaults("url=https://example.com?k=v&q=r")).toEqual({
      url: "https://example.com?k=v&q=r",
    });
  });

  test("null / empty / non-string returns {}", () => {
    expect(parseScriptstateDefaults(null)).toEqual({});
    expect(parseScriptstateDefaults("")).toEqual({});
    expect(parseScriptstateDefaults("no_equals_here")).toEqual({});
    expect(parseScriptstateDefaults("=leading_eq")).toEqual({});
  });
});

describe("extractLuaScripts", () => {
  function t(effect: unknown[]): TriggerScript {
    return {
      comment: "",
      type: "input",
      conditions: [],
      effect: effect as TriggerScript["effect"],
    };
  }

  test("parallel to triggers, empty string for no-Lua triggers", () => {
    const triggers = [
      t([{ type: "setvar", var: "x", operator: "=", value: "1" }]),
      t([{ type: "triggerlua", code: "print('hello')" }]),
      t([{ type: "setvar", var: "y", operator: "=", value: "2" }]),
    ];
    expect(extractLuaScripts(triggers)).toEqual([
      "",
      "print('hello')",
      "",
    ]);
  });

  test("concatenates multiple triggerlua effects within one trigger with newlines", () => {
    const triggers = [
      t([
        { type: "triggerlua", code: "line1" },
        { type: "setvar", var: "x", operator: "=", value: "1" },
        { type: "triggerlua", code: "line2" },
      ]),
    ];
    expect(extractLuaScripts(triggers)).toEqual(["line1\nline2"]);
  });

  test("handles triggers with no effects", () => {
    expect(extractLuaScripts([t([])])).toEqual([""]);
  });
});

describe("extractRisuaiExtra", () => {
  test("strips known fields, keeps unknown ones verbatim", () => {
    const extensions = {
      risuai: {
        backgroundHTML: "dropped",
        customScripts: [],
        triggerscript: [],
        virtualscript: "",
        defaultVariables: "a=1",
        utilityBot: false,
        // Unknown pass-throughs — translator hasn't modeled these, extension
        // may learn about them later.
        future_risu_flag: "keep me",
        image_exclude: ["a.png", "b.png"],
        emotion_map: { happy: "happy.png" },
      },
      other_ext: "separate namespace, should be ignored",
    };
    expect(extractRisuaiExtra(extensions)).toEqual({
      future_risu_flag: "keep me",
      image_exclude: ["a.png", "b.png"],
      emotion_map: { happy: "happy.png" },
    });
  });

  test("non-object / missing risuai returns {}", () => {
    expect(extractRisuaiExtra({})).toEqual({});
    expect(extractRisuaiExtra({ risuai: null })).toEqual({});
    expect(extractRisuaiExtra({ risuai: "weird" })).toEqual({});
    expect(extractRisuaiExtra({ risuai: ["an", "array"] })).toEqual({});
  });
});

describe("buildRisuPayload — full assembly", () => {
  test("carries triggers, lua, at_actions, flags, extra, requires, version fields", () => {
    const triggers: readonly TriggerScript[] = [
      {
        comment: "lua one",
        type: "start",
        conditions: [],
        effect: [{ type: "triggerlua", code: "setChatVar('x', 1)" } as never],
      },
      {
        comment: "setvar one",
        type: "input",
        conditions: [],
        effect: [{ type: "setvar", var: "y", operator: "=", value: "2" } as never],
      },
    ];
    const payload = buildRisuPayload({
      translatorVersion: "9.9.9",
      risuSpecVersion: "risu-test",
      triggers,
      atActions: [
        { index: 0, action: "emo", script: {} as never, flag: "g", phase: "editoutput", actions: [], order: 0 },
      ],
      extracted: {
        characterBook: null,
        backgroundHTML: "<div>{mood}</div>",
        customScripts: [],
        triggerScripts: [],
        virtualScript: "return 1",
        defaultVariables: "hp=100\nmp=50",
        assets: [],
        depthPrompt: null,
        additionalText: null,
        utilityBot: true,
      },
      characterExtensions: {
        risuai: {
          backgroundHTML: "<div>{mood}</div>",
          utilityBot: true,
          future_flag: "future",
        },
      },
      requires: {
        lowLevelAccess: false,
        hostFeatures: ["alertSelect", "utilityBot"],
        lua: true,
      },
      untranslated: { utility_bot: true },
    });

    // Triggers pass through verbatim (identity preserved for the extension to
    // walk — no transformation happens at translate time).
    expect(payload.triggers).toBe(triggers);

    // Lua scripts aligned with triggers.
    expect(payload.lua_scripts).toEqual(["setChatVar('x', 1)", ""]);

    expect(payload.at_actions).toHaveLength(1);
    expect(payload.background_html).toBe("<div>{mood}</div>");
    expect(payload.virtualscript).toBe("return 1");
    expect(payload.utility_bot).toBe(true);
    expect(payload.scriptstate_defaults).toEqual({ hp: "100", mp: "50" });
    expect(payload.extra).toEqual({ future_flag: "future" });
    expect(payload.translator_version).toBe("9.9.9");
    expect(payload.risu_spec_version).toBe("risu-test");
    expect(payload.requires.lua).toBe(true);
    expect(payload.requires.hostFeatures).toEqual(["alertSelect", "utilityBot"]);
    expect(payload.untranslated).toEqual({ utility_bot: true });
  });

  test("untranslated is omitted when nothing was flagged", () => {
    const payload = buildRisuPayload({
      translatorVersion: "1",
      risuSpecVersion: "risu-1",
      triggers: [],
      atActions: [],
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
      characterExtensions: {},
      requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
    });
    expect("untranslated" in payload).toBe(false);
    expect(payload.triggers).toEqual([]);
    expect(payload.lua_scripts).toEqual([]);
    expect(payload.extra).toEqual({});
    expect(payload.scriptstate_defaults).toEqual({});
  });
});
