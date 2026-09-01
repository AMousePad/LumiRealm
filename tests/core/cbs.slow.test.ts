import { describe, test, expect } from "bun:test";
import { listLibraryCards } from "../helpers/local-library.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCbs, serialize, lex, normalizeMacroName, parseMacroInner } from "../../src/core/cbs/index.js";
import { readCharx } from "../../src/core/charx/reader.js";

// ─── helpers: round-trip assertion ─────────────────────────────────────────

/** `serialize(parseCbs(s)) === s` — the core M7 invariant. */
function assertRoundTrip(s: string): void {
  const ast = parseCbs(s);
  const back = serialize(ast);
  expect(back).toBe(s);
}

// ─── lexer ─────────────────────────────────────────────────────────────────

describe("lex", () => {
  test("plain text yields one text token", () => {
    expect(lex("hello world")).toEqual([
      { kind: "text", value: "hello world", start: 0, end: 11 },
    ]);
  });

  test("empty string yields empty", () => {
    expect(lex("")).toEqual([]);
  });

  test("recognizes {{ and }}", () => {
    const toks = lex("a{{b}}c");
    expect(toks.map((t) => [t.kind, t.value])).toEqual([
      ["text", "a"], ["open", "{{"], ["text", "b"], ["close", "}}"], ["text", "c"],
    ]);
  });

  test("recognizes legacy {# and #}", () => {
    const toks = lex("{#if x#}");
    expect(toks.map((t) => t.kind)).toEqual(["legacy_open", "text", "legacy_close"]);
  });

  test("lone { and } stay as text", () => {
    const toks = lex("a { b } c");
    expect(toks).toEqual([{ kind: "text", value: "a { b } c", start: 0, end: 9 }]);
  });
});

// ─── normalize / split ─────────────────────────────────────────────────────

describe("normalizeMacroName", () => {
  test("lowercases, strips spaces / underscores / dashes", () => {
    expect(normalizeMacroName("My_Great-Macro Name")).toBe("mygreatmacroname");
    expect(normalizeMacroName("GETVAR")).toBe("getvar");
    expect(normalizeMacroName("pure_display")).toBe("puredisplay");
  });
});

describe("parseMacroInner", () => {
  test("no args → name alone", () => {
    expect(parseMacroInner("user")).toEqual({ name: "user", args: [] });
  });
  test("double-colon splits", () => {
    expect(parseMacroInner("getvar::name")).toEqual({ name: "getvar", args: ["name"] });
    expect(parseMacroInner("setvar::x::42")).toEqual({ name: "setvar", args: ["x", "42"] });
  });
  test("single colon (no ::) splits once", () => {
    expect(parseMacroInner("foo:bar:baz")).toEqual({ name: "foo", args: ["bar:baz"] });
  });
  test("name normalization applies", () => {
    expect(parseMacroInner("Get-Var::x")).toEqual({ name: "getvar", args: ["x"] });
  });
});

// ─── parser: round-trip ────────────────────────────────────────────────────

describe("parseCbs — round-trip on well-formed inputs", () => {
  const cases: string[] = [
    "",
    "plain text with no macros",
    "Hello {{user}}, I'm {{char}}.",
    "{{getvar::foo}}",
    "{{setvar::x::42}} then {{getvar::x}}",
    "{{#if foo}}yes{{/if}}",
    "{{#if foo}}yes{{:else}}no{{/if}}",
    "{{#when::var::foo::is::bar}}X{{/when}}",
    "{{#each list as x}}item: {{slot::x}}\n{{/each}}",
    "{{#func greet arg}}Hello {{arg::0}}{{/func}}{{call::greet::world}}",
    "{{#pure}}this has {{user}} inside literally{{/pure}}",
    "{{#escape}}x{{/escape}}",
    "{{#ignore}}nothing{{/ignore}}",
    "{{#code}}a\\nb{{/code}}",
    "{{#puredisplay}}{{user}}{{/puredisplay}}",
    "{{#pure_display}}{{user}}{{/pure_display}}",
    "{#if x#}",  // legacy form
    "a{{b}}c{#d#}e",
    "nested: {{#if x}}{{#if y}}z{{/if}}{{/if}}",
    "unicode: 한국어 {{char}} 日本語",
    "raw {{slot::name}}",
  ];
  for (const s of cases) {
    test(`round-trip: ${JSON.stringify(s).slice(0, 60)}`, () => {
      assertRoundTrip(s);
    });
  }
});

describe("parseCbs — round-trip on malformed inputs (Risu recovery)", () => {
  const cases: string[] = [
    "{{ unterminated",
    "unterminated }}",
    "{{/orphanclose}}",
    "{#legacy with no close",
    "{{#if foo}} without close",
    "{{",
    "}}",
    "{{}}",
    "{{}}",
    "{{:else}} at top level",  // stray separator
    "{#}",
    "{{{{}}}}", // weird double-brace
  ];
  for (const s of cases) {
    test(`recovery round-trip: ${JSON.stringify(s)}`, () => {
      assertRoundTrip(s);
    });
  }
});

// ─── parser: structural shape ──────────────────────────────────────────────

describe("parseCbs — AST shape", () => {
  test("simple macro", () => {
    const ast = parseCbs("{{getvar::x}}");
    expect(ast.nodes).toEqual([
      { type: "macro", name: "getvar", args: ["x"], raw: "getvar::x" },
    ]);
  });

  test("if block with else, structural children", () => {
    const ast = parseCbs("{{#if foo}}{{user}}{{:else}}none{{/if}}");
    expect(ast.nodes.length).toBe(1);
    const b = ast.nodes[0]!;
    expect(b.type).toBe("block");
    if (b.type !== "block") throw new Error();
    expect(b.kind).toBe("if");
    expect(b.headerRaw).toBe("if foo");
    expect(b.closeRaw).toBe("/if");
    expect(b.children).toHaveLength(1);
    expect(b.children![0]).toEqual({ type: "macro", name: "user", args: [], raw: "user" });
    expect(b.elseChildren).toHaveLength(1);
    expect(b.elseChildren![0]).toEqual({ type: "text", value: "none" });
  });

  test("pure block captures body as raw (no child macros parsed)", () => {
    const ast = parseCbs("{{#pure}}Hello {{user}}{{/pure}}");
    const b = ast.nodes[0]!;
    if (b.type !== "block") throw new Error();
    expect(b.kind).toBe("pure");
    expect(b.bodyRaw).toBe("Hello {{user}}");
    expect(b.children).toBeUndefined();
  });

  test("each block is opaque (raw body)", () => {
    const ast = parseCbs("{{#each list as x}}item {{slot::x}}\n{{/each}}");
    const b = ast.nodes[0]!;
    if (b.type !== "block") throw new Error();
    expect(b.kind).toBe("each");
    expect(b.bodyRaw).toBe("item {{slot::x}}\n");
  });

  test("unknown block kinds preserve verbatim", () => {
    const ast = parseCbs("{{#brandnewblock arg}}body{{/brandnewblock}}");
    const b = ast.nodes[0]!;
    if (b.type !== "block") throw new Error();
    expect(b.kind).toBe("unknown");
    expect(b.headerRaw).toBe("brandnewblock arg");
    // Unknown = structural; children present.
    expect(b.children).toBeDefined();
  });

  test("legacy {#...#}", () => {
    const ast = parseCbs("x{#if y#}z");
    expect(ast.nodes).toEqual([
      { type: "text", value: "x" },
      { type: "legacy", raw: "if y" },
      { type: "text", value: "z" },
    ]);
  });

  test("orphan close emitted as text", () => {
    const ast = parseCbs("hello {{/pure}} world");
    expect(ast.nodes).toEqual([
      { type: "text", value: "hello " },
      { type: "text", value: "{{/pure}}" },
      { type: "text", value: " world" },
    ]);
  });
});

// ─── corpus sweep: every string field in every charx must round-trip ───────

const listCharxs = (): string[] => listLibraryCards();

/** Walk a value, yield every string leaf. */
function* allStrings(v: unknown): Generator<string> {
  if (typeof v === "string") { yield v; return; }
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) yield* allStrings(x);
    return;
  }
  for (const k of Object.keys(v)) yield* allStrings((v as Record<string, unknown>)[k]);
}

describe("parseCbs — corpus round-trip", () => {
  const charxs = listCharxs();
  if (charxs.length === 0) {
    test.skip("no corpus", () => {});
    return;
  }

  test("every string in every card.json round-trips", () => {
    let totalStrings = 0;
    let totalWithMacros = 0;
    let mismatches = 0;
    const mismatchSamples: { file: string; s: string; got: string }[] = [];

    for (const path of charxs) {
      const name = path.split(/[\\/]/).pop()!;
      const bundle = readCharx(new Uint8Array(readFileSync(path)), { decodeModule: false });
      for (const s of allStrings(bundle.card)) {
        totalStrings++;
        if (s.indexOf("{{") >= 0 || s.indexOf("{#") >= 0) totalWithMacros++;
        const back = serialize(parseCbs(s));
        if (back !== s) {
          mismatches++;
          if (mismatchSamples.length < 5) mismatchSamples.push({ file: name, s, got: back });
        }
      }
    }
    if (mismatches > 0) {
      console.log("[cbs corpus] mismatch samples:", mismatchSamples);
    }
    console.log(`\n[cbs corpus] ${totalStrings} strings scanned, ${totalWithMacros} contained {{ or {#`);
    expect(mismatches).toBe(0);
  }, 180_000);

  test("every string in every module.risum round-trips", () => {
    let totalStrings = 0;
    let totalWithMacros = 0;
    let mismatches = 0;
    const mismatchSamples: { file: string; s: string; got: string }[] = [];

    for (const path of charxs) {
      const name = path.split(/[\\/]/).pop()!;
      const bundle = readCharx(new Uint8Array(readFileSync(path)));
      if (!bundle.moduleEnvelope) continue;
      for (const s of allStrings(bundle.moduleEnvelope.module)) {
        totalStrings++;
        if (s.indexOf("{{") >= 0 || s.indexOf("{#") >= 0) totalWithMacros++;
        const back = serialize(parseCbs(s));
        if (back !== s) {
          mismatches++;
          if (mismatchSamples.length < 5) mismatchSamples.push({ file: name, s, got: back });
        }
      }
    }
    if (mismatches > 0) {
      console.log("[cbs module corpus] mismatch samples:", mismatchSamples);
    }
    console.log(`\n[cbs module corpus] ${totalStrings} strings scanned, ${totalWithMacros} contained {{ or {#`);
    expect(mismatches).toBe(0);
  }, 180_000);
});
