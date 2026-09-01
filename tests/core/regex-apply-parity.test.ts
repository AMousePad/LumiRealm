import { describe, test, expect } from "bun:test";
import { applyRegexScriptsCore, type RegexCoreScript } from "../../src/display/regex-core.js";

function script(overrides: Partial<RegexCoreScript>): RegexCoreScript {
  return {
    find_regex: "",
    replace_string: "",
    flags: "g",
    substitute_macros: "none",
    placement: ["user_input", "ai_output"],
    target: "display",
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    ...overrides,
  };
}

function spy() {
  const calls: string[] = [];
  const ev = (t: string): string => {
    calls.push(t);
    return t.replace(/\{\{x\}\}/g, "X");
  };
  return { calls, ev };
}

describe("applyRegexScriptsCore — none mode", () => {
  test("literal find/replace, no eval", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "hello world",
      [script({ find_regex: "world", replace_string: "there", substitute_macros: "none" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("hello there");
    expect(calls.length).toBe(0);
  });

  test("capture group $1 interpolation, no eval", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "name: Alice",
      [script({ find_regex: "name: (\\w+)", replace_string: "[$1]", substitute_macros: "none" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("[Alice]");
    expect(calls.length).toBe(0);
  });

  test("does not eval even when replace contains {{macro}}", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "a",
      [script({ find_regex: "a", replace_string: "{{x}}", substitute_macros: "none" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("{{x}}");
    expect(calls.length).toBe(0);
  });
});

describe("applyRegexScriptsCore — escaped mode", () => {
  test("replace_string macro resolved once and $ doubled so capture refs stay literal", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "tok",
      [script({ find_regex: "tok", replace_string: "{{x}}-$1", substitute_macros: "escaped" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("X-$1");
    expect(calls).toEqual(["tok", "{{x}}-$1"]);
  });

  test("find is pre-resolved through eval when mode != none", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "ZZZ",
      [script({ find_regex: "{{x}}", replace_string: "hit", substitute_macros: "escaped" })],
      { placement: "user_input", depth: undefined, evalTemplate: (t) => { calls.push(t); return t.replace("{{x}}", "ZZZ"); } },
    );
    expect(out).toBe("hit");
    expect(calls[0]).toBe("{{x}}");
  });
});

describe("applyRegexScriptsCore — find-only macro parsing", () => {
  test("resolves the find pattern without resolving the replacement", () => {
    const calls: string[] = [];
    const out = applyRegexScriptsCore(
      "Alice",
      [script({
        find_regex: "<USER>",
        replace_string: "{{x}}",
        substitute_macros: "find",
      })],
      {
        placement: "user_input",
        depth: undefined,
        evalTemplate: (text) => {
          calls.push(text);
          return text.replace("<USER>", "Alice").replace("{{x}}", "wrong");
        },
      },
    );
    expect(out).toBe("{{x}}");
    expect(calls).toEqual(["<USER>"]);
  });
});

describe("applyRegexScriptsCore — after mode", () => {
  test("find pre-resolved (mode != none) then ONE eval over whole substituted body", () => {
    const calls: string[] = [];
    const ev = (t: string): string => { calls.push(t); return t.replace(/\{\{x\}\}/g, "X"); };
    const out = applyRegexScriptsCore(
      "say hi to Bob",
      [script({ find_regex: "hi to (\\w+)", replace_string: "{{x}} $1", substitute_macros: "after" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("say X Bob");
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe("hi to (\\w+)");
    expect(calls[1]).toBe("say {{x}} Bob");
  });
});

describe("applyRegexScriptsCore — raw mode", () => {
  test("per-match eval; eval count == 1 find pre-resolve + match count", () => {
    const calls: string[] = [];
    const ev = (t: string): string => {
      calls.push(t);
      if (t === "(\\w)(\\d)") return t;
      return t.toUpperCase();
    };
    const out = applyRegexScriptsCore(
      "a1 b2 c3",
      [script({ find_regex: "(\\w)(\\d)", replace_string: "$2$1", substitute_macros: "raw", flags: "g" })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("1A 2B 3C");
    expect(calls.length).toBe(4);
    expect(calls[0]).toBe("(\\w)(\\d)");
    expect(calls.slice(1)).toEqual(["1a", "2b", "3c"]);
  });
});

describe("applyRegexScriptsCore — carry forward", () => {
  test("applies the replacement to the previous match by default", () => {
    const { ev } = spy();
    const out = applyRegexScriptsCore(
      "new",
      [script({
        find_regex: "<status>([^<]+)</status>",
        replace_string: "<strong>$1</strong>",
        matchActions: ["repeat_back"],
        repeatPosition: "end_nl",
      })],
      {
        placement: "ai_output",
        depth: 0,
        previousContent: "old <status>ready</status>",
        evalTemplate: ev,
      },
    );
    expect(out).toBe("new\n<strong>ready</strong>");
  });

  test("can carry the original previous match without replacing it", () => {
    const { ev } = spy();
    const out = applyRegexScriptsCore(
      "new",
      [script({
        find_regex: "<status>([^<]+)</status>",
        replace_string: "<strong>$1</strong>",
        matchActions: ["repeat_back"],
        repeatPosition: "end_nl",
        repeatRawMatch: true,
      })],
      {
        placement: "ai_output",
        depth: 0,
        previousContent: "old <status>ready</status>",
        evalTemplate: ev,
      },
    );
    expect(out).toBe("new\n<status>ready</status>");
  });
});

describe("applyRegexScriptsCore — placement gate", () => {
  test("ai_output-only script skipped on user_input", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "x",
      [script({ find_regex: "x", replace_string: "y", placement: ["ai_output"] })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("x");
    expect(calls.length).toBe(0);
  });
});

describe("applyRegexScriptsCore — depth gate", () => {
  test("max_depth:0 applied at depth 0, skipped at depth 3", () => {
    const { ev } = spy();
    const s = script({ find_regex: "x", replace_string: "y", max_depth: 0 });
    expect(applyRegexScriptsCore("x", [s], { placement: "user_input", depth: 0, evalTemplate: ev })).toBe("y");
    expect(applyRegexScriptsCore("x", [s], { placement: "user_input", depth: 3, evalTemplate: ev })).toBe("x");
  });

  test("editprocess (max_depth:null) applied at all depths", () => {
    const { ev } = spy();
    const s = script({ find_regex: "x", replace_string: "y", max_depth: null, min_depth: null });
    expect(applyRegexScriptsCore("x", [s], { placement: "user_input", depth: 0, evalTemplate: ev })).toBe("y");
    expect(applyRegexScriptsCore("x", [s], { placement: "user_input", depth: 99, evalTemplate: ev })).toBe("y");
  });

  test("depth undefined disables the depth gate", () => {
    const { ev } = spy();
    const s = script({ find_regex: "x", replace_string: "y", max_depth: 0 });
    expect(applyRegexScriptsCore("x", [s], { placement: "user_input", depth: undefined, evalTemplate: ev })).toBe("y");
  });
});

describe("applyRegexScriptsCore — trim_strings", () => {
  test("removes all occurrences after replace", () => {
    const { ev } = spy();
    const out = applyRegexScriptsCore(
      "--a--b--",
      [script({ find_regex: "x", replace_string: "y", trim_strings: ["--"] })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("ab");
  });
});

describe("applyRegexScriptsCore — disabled", () => {
  test("disabled:true is a no-op", () => {
    const { calls, ev } = spy();
    const out = applyRegexScriptsCore(
      "x",
      [script({ find_regex: "x", replace_string: "y", disabled: true })],
      { placement: "user_input", depth: undefined, evalTemplate: ev },
    );
    expect(out).toBe("x");
    expect(calls.length).toBe(0);
  });
});
