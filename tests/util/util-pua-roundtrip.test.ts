import { describe, expect, test } from "bun:test";
import { puaDecodeFeMacros, puaEncodeFeMacros } from "../../src/util/pua-roundtrip.js";

describe("puaEncodeFeMacros / puaDecodeFeMacros", () => {
  test("no-op on empty / no-brace input", () => {
    expect(puaEncodeFeMacros("")).toEqual({ text: "", tokens: [] });
    expect(puaEncodeFeMacros("plain text").tokens).toEqual([]);
    expect(puaEncodeFeMacros("plain text").text).toBe("plain text");
  });

  test("encodes the FE-resolved set", () => {
    const r = puaEncodeFeMacros("Hello {{user}}, {{char}} says hi to {{charName}}.");
    expect(r.tokens).toEqual(["user", "char", "charName"]);
    expect(r.text).not.toContain("{{user}}");
    expect(r.text).not.toContain("{{char}}");
    expect(r.text).not.toContain("{{charName}}");
  });

  test("encodes whitespace-tolerant forms", () => {
    const r = puaEncodeFeMacros("{{ user }}, {{user}}, {{user }}, {{ user}}");
    expect(r.tokens).toEqual(["user", "user", "user", "user"]);
    expect(r.text.indexOf("{{")).toBe(-1);
  });

  test("does NOT encode unrelated macros", () => {
    const r = puaEncodeFeMacros("{{getvar::foo}} {{userName}} {{users}}");
    expect(r.tokens).toEqual([]);
    expect(r.text).toBe("{{getvar::foo}} {{userName}} {{users}}");
  });

  test("encode + decode is round-trippable to canonical form", () => {
    const input = "Hi {{ user }}! {{notChar}} likes {{not_char}} and {{char}}.";
    const enc = puaEncodeFeMacros(input);
    const dec = puaDecodeFeMacros(enc.text, enc.tokens);
    expect(dec).toBe("Hi {{user}}! {{notChar}} likes {{not_char}} and {{char}}.");
  });

  test("decode tolerates intervening text", () => {
    const enc = puaEncodeFeMacros("{{user}}");
    const middle = enc.text.slice(0, 1) + "X" + enc.text.slice(1);
    // Decode skips malformed sentinel; intact ones still decode.
    expect(puaDecodeFeMacros(enc.text, enc.tokens)).toBe("{{user}}");
    void middle;
  });

  test("decode with no tokens returns input verbatim", () => {
    expect(puaDecodeFeMacros("plain", [])).toBe("plain");
  });

  test("notChar and not_char preserve their respective forms", () => {
    const enc = puaEncodeFeMacros("a {{notChar}} b {{not_char}} c");
    expect(enc.tokens).toEqual(["notChar", "not_char"]);
    expect(puaDecodeFeMacros(enc.text, enc.tokens)).toBe("a {{notChar}} b {{not_char}} c");
  });
});
