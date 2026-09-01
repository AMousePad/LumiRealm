import { describe, test, expect } from "bun:test";
import { applyPromptRegexToArray } from "../../src/interceptors/prompt-regex-apply.js";
import type { RegexCoreScript } from "../../src/display/regex-core.js";
import type { LlmMessage } from "../../src/adapters/spindle-extras.js";
import type { PrebuiltPipelineInput } from "../../src/interceptors/prompt-regex-apply.js";

function script(overrides: Partial<RegexCoreScript>): RegexCoreScript {
  return {
    find_regex: "",
    replace_string: "",
    flags: "g",
    substitute_macros: "none",
    placement: ["user_input", "ai_output"],
    target: "prompt",
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    ...overrides,
  };
}

const editinput = (over: Partial<RegexCoreScript> = {}): RegexCoreScript =>
  script({ placement: ["user_input"], max_depth: 0, min_depth: null, ...over });

const editprocess = (over: Partial<RegexCoreScript> = {}): RegexCoreScript =>
  script({ placement: ["user_input", "ai_output"], max_depth: null, min_depth: null, ...over });

const PREBUILT = {} as unknown as PrebuiltPipelineInput;

function msg(role: LlmMessage["role"], content: string): LlmMessage {
  return { role, content };
}

describe("applyPromptRegexToArray — editinput depth gating (max_depth:0)", () => {
  test("applies only to the trailing user message", async () => {
    const messages: LlmMessage[] = [
      msg("system", "X"),
      msg("user", "X"),
      msg("assistant", "X"),
      msg("user", "X"),
    ];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editinput({ find_regex: "X", replace_string: "Y" })],
    );
    expect(changed).toBe(true);
    expect(messages.map((m) => m.content)).toEqual(["X", "X", "X", "Y"]);
  });

  test("non-trailing user message (depth>0) is not touched", async () => {
    const messages: LlmMessage[] = [
      msg("user", "X"),
      msg("assistant", "X"),
      msg("user", "X"),
      msg("assistant", "X"),
    ];
    await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editinput({ find_regex: "X", replace_string: "Y" })],
    );
    expect(messages.map((m) => m.content)).toEqual(["X", "X", "X", "X"]);
  });
});

describe("applyPromptRegexToArray — editprocess (max_depth:null)", () => {
  test("applies to all non-system messages, never system", async () => {
    const messages: LlmMessage[] = [
      msg("system", "X"),
      msg("user", "X"),
      msg("assistant", "X"),
      msg("user", "X"),
    ];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editprocess({ find_regex: "X", replace_string: "Y" })],
    );
    expect(changed).toBe(true);
    expect(messages.map((m) => m.content)).toEqual(["X", "Y", "Y", "Y"]);
  });
});

describe("applyPromptRegexToArray — carry forward", () => {
  const conversation = (): LlmMessage[] => [
    msg("assistant", "greeting"),
    msg("user", "first"),
    msg("assistant", "old <status>ready</status>"),
    msg("user", "next"),
    msg("assistant", "new"),
  ];

  test("applies Replace to the previous same-role match by default", async () => {
    const messages = conversation();
    await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editprocess({
        find_regex: "<status>([^<]+)</status>",
        replace_string: "<strong>$1</strong>",
        matchActions: ["repeat_back"],
        repeatPosition: "end_nl",
      })],
    );
    expect(messages[4]!.content).toBe("new\n<strong>ready</strong>");
  });

  test("can carry the original previous match", async () => {
    const messages = conversation();
    await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editprocess({
        find_regex: "<status>([^<]+)</status>",
        replace_string: "<strong>$1</strong>",
        matchActions: ["repeat_back"],
        repeatPosition: "end_nl",
        repeatRawMatch: true,
      })],
    );
    expect(messages[4]!.content).toBe("new\n<status>ready</status>");
  });
});

describe("applyPromptRegexToArray — placement guards system", () => {
  test("user_input rule never matches a system message", async () => {
    const messages: LlmMessage[] = [msg("system", "X")];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [script({ find_regex: "X", replace_string: "Y", placement: ["user_input"] })],
    );
    expect(changed).toBe(false);
    expect(messages[0]!.content).toBe("X");
  });

  test("ai_output rule never matches a system message", async () => {
    const messages: LlmMessage[] = [msg("system", "X")];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [script({ find_regex: "X", replace_string: "Y", placement: ["ai_output"] })],
    );
    expect(changed).toBe(false);
    expect(messages[0]!.content).toBe("X");
  });

  test("world_info rule matches a system message", async () => {
    const messages: LlmMessage[] = [msg("system", "X")];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [script({ find_regex: "X", replace_string: "Y", placement: ["world_info"] })],
    );
    expect(changed).toBe(true);
    expect(messages[0]!.content).toBe("Y");
  });
});

describe("applyPromptRegexToArray — positional depth", () => {
  test("depth counts only non-system, newest=0, oldest highest", async () => {
    const messages: LlmMessage[] = [
      msg("system", "S"),
      msg("user", "u-old"),
      msg("assistant", "a-mid"),
      msg("user", "u-new"),
    ];
    const minDepth = script({
      find_regex: "u",
      replace_string: "U",
      placement: ["user_input"],
      min_depth: 1,
    });
    await applyPromptRegexToArray(messages, PREBUILT, [minDepth]);
    expect(messages.map((m) => m.content)).toEqual(["S", "U-old", "a-mid", "u-new"]);
  });

  test("system is skipped when computing depth (system content unchanged, history depths intact)", async () => {
    const messages: LlmMessage[] = [
      msg("user", "X"),
      msg("system", "X"),
      msg("user", "X"),
    ];
    await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editinput({ find_regex: "X", replace_string: "Y" })],
    );
    expect(messages.map((m) => m.content)).toEqual(["X", "X", "Y"]);
  });
});

describe("applyPromptRegexToArray — multipart content", () => {
  test("applies to each text part, leaves non-text parts", async () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello X" },
          { type: "image_url", image_url: { url: "u" } },
          { type: "text", text: "world X" },
        ],
      },
    ] as unknown as LlmMessage[];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editprocess({ find_regex: "X", replace_string: "Y" })],
    );
    expect(changed).toBe(true);
    const parts = (messages[0] as unknown as { content: { type: string; text?: string }[] }).content;
    expect(parts[0]!.text).toBe("hello Y");
    expect(parts[1]!.text).toBeUndefined();
    expect(parts[2]!.text).toBe("world Y");
  });
});

describe("applyPromptRegexToArray — script set already filtered to target:prompt", () => {
  test("empty script set is a no-op (no eval, no mutation)", async () => {
    const messages: LlmMessage[] = [msg("user", "X")];
    const { changed } = await applyPromptRegexToArray(messages, PREBUILT, []);
    expect(changed).toBe(false);
    expect(messages[0]!.content).toBe("X");
  });

  test("evalTemplate (runPipeline) is never invoked for substitute_macros:none rules", async () => {
    const messages: LlmMessage[] = [msg("user", "{{char}} X")];
    const { changed } = await applyPromptRegexToArray(
      messages,
      PREBUILT,
      [editprocess({ find_regex: "X", replace_string: "Y", substitute_macros: "none" })],
    );
    expect(changed).toBe(true);
    expect(messages[0]!.content).toBe("{{char}} Y");
  });
});
