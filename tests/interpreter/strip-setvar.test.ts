import { describe, test, expect } from "bun:test";
import { stripSetvarSpans, hasSetvarFamily } from "../../src/interpreter/evaluator/strip-setvar.js";

// execSpan stub: setvar family returns "" (like the real handlers), records spans.
function run(text: string) {
  const seen: string[] = [];
  const res = stripSetvarSpans(text, (span) => { seen.push(span); return ""; });
  return { ...res, seen };
}

describe("stripSetvarSpans", () => {
  test("strips a top-level setvar, leaves other text", () => {
    const r = run("Hello {{setvar::hp::100}}world");
    expect(r.text).toBe("Hello world");
    expect(r.changed).toBe(true);
    expect(r.ran).toBe(1);
    expect(r.seen).toEqual(["{{setvar::hp::100}}"]);
  });

  test("leaves getvar/char untouched (reactivity preserved)", () => {
    const r = run("{{char}}: hp={{getvar::hp}} {{setvar::seen::1}}");
    expect(r.text).toBe("{{char}}: hp={{getvar::hp}} ");
    expect(r.seen).toEqual(["{{setvar::seen::1}}"]);
  });

  test("nested arg macro stays inside the one span", () => {
    const r = run("{{setvar::hp::{{getvar::base}}}}X");
    expect(r.text).toBe("X");
    expect(r.seen).toEqual(["{{setvar::hp::{{getvar::base}}}}"]);
  });

  test("setvar inside a block is left alone", () => {
    const src = "{{#if::x}}{{setvar::a::1}}{{/if}}";
    const r = run(src);
    expect(r.text).toBe(src);
    expect(r.changed).toBe(false);
    expect(r.seen).toEqual([]);
  });

  test("addvar / setdefaultvar strip", () => {
    for (const m of ["{{addvar::n::1}}", "{{setdefaultvar::n::0}}"]) {
      const r = run(`a${m}b`);
      expect(r.text).toBe("ab");
      expect(r.ran).toBe(1);
    }
  });

  test("deletevar / flushvar / setchatvar stay literal (not Risu CBS macros)", () => {
    for (const m of ["{{deletevar::n}}", "{{flushvar::n}}", "{{setchatvar::n::x}}"]) {
      const r = run(`a${m}b`);
      expect(r.text).toBe(`a${m}b`);
      expect(r.changed).toBe(false);
    }
  });

  test("settempvar stays literal (per-render scratch, pairs with gettempvar)", () => {
    const src = "{{settempvar::t::1}}{{gettempvar::t}}";
    const r = run(src);
    expect(r.text).toBe(src);
    expect(r.changed).toBe(false);
  });

  test("no setvar family = untouched, no scan work", () => {
    const src = "plain {{getvar::x}} {{char}}";
    const r = run(src);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(src);
    expect(hasSetvarFamily(src)).toBe(false);
  });

  test("unbalanced braces emit the rest verbatim", () => {
    const r = run("{{setvar::a::1}} tail {{setvar::b::2");
    expect(r.text).toBe(" tail {{setvar::b::2");
  });

  test("mixed: setvar strips while deletevar in same message stays literal", () => {
    const r = run("{{setvar::a::1}}{{deletevar::a}}");
    expect(r.text).toBe("{{deletevar::a}}");
    expect(r.ran).toBe(1);
  });

  test("multiple top-level setvars all strip in order", () => {
    const r = run("{{setvar::a::1}}mid{{addvar::b::2}}");
    expect(r.text).toBe("mid");
    expect(r.ran).toBe(2);
    expect(r.seen).toEqual(["{{setvar::a::1}}", "{{addvar::b::2}}"]);
  });
});
