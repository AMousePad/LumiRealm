import { describe, test, expect } from "bun:test";
import {
  evaluate,
  buildEvaluatorContext,
  type EvaluatorCtx,
} from "../../src/interpreter/evaluator/index.js";

// Minimal helper — build a ctx for a solo invocation with supplied
// identity/variables. `chatId` empty string disables the Spindle
// writeback path (spindle global is undefined in tests anyway).
function makeCtx(overrides: {
  userName?: string;
  charName?: string;
  local?: Record<string, string>;
  global?: Record<string, string>;
  messageCount?: number;
  lastMessage?: string;
  lastUserMessage?: string;
  lastCharMessage?: string;
  lastMessageId?: number;
  commit?: boolean;
  rmVar?: boolean;
  runVar?: boolean;
  chatId?: string;
} = {}): EvaluatorCtx {
  return buildEvaluatorContext({
    ...(overrides.rmVar ? { rmVar: true } : {}),
    ...(overrides.runVar ? { runVar: true } : {}),
    chatId: overrides.chatId ?? "test-chat",
    userName: overrides.userName ?? "Alice",
    charName: overrides.charName ?? "Bob",
    character: {
      description: "a character",
      jailbreakPrompt: "",
    },
    chat: {
      messageCount: overrides.messageCount ?? 1,
      lastMessage: overrides.lastMessage ?? "",
      lastUserMessage: overrides.lastUserMessage ?? "",
      lastCharMessage: overrides.lastCharMessage ?? "",
      ...(overrides.lastMessageId != null ? { lastMessageId: overrides.lastMessageId } : {}),
    },
    variables: {
      ...(overrides.local ? { local: overrides.local } : {}),
      ...(overrides.global ? { global: overrides.global } : {}),
    },
    commit: overrides.commit ?? true,
  });
}

describe("evaluator: identity and plain text", () => {
  test("plain text passes through", () => {
    expect(evaluate("hello world", makeCtx())).toBe("hello world");
  });
  // `{{user}}/{{char}}/{{charName}}/{{notChar}}/{{not_char}}` and the
  // `<USER>/<BOT>/<CHAR>` legacy tokens are deliberately NOT registered in
  // our in-worker evaluator. Lumi's frontend `resolveDisplayMacros`
  // (Lumiverse `frontend/src/lib/resolveDisplayMacros.ts`) resolves them at
  // render time against the active persona context. Server-side resolution
  // would freeze the values into the render-MCP / display-preprocess caches
  // (neither keys on personaId), breaking persona-swap reactivity.
  // `{{bot}}` is the one exception — registered in `builtins.ts`.
});

describe("evaluator: unknown macro passthrough", () => {
  test("unknown leaf macro renders as literal {{name}} (Risu :1757-1758)", () => {
    expect(evaluate("x{{totally_unknown_macro_xyz}}y", makeCtx()))
      .toBe("x{{totally_unknown_macro_xyz}}y");
  });
  test("unknown macro with args also passthroughs verbatim", () => {
    expect(evaluate("{{mystery::a::b}}", makeCtx()))
      .toBe("{{mystery::a::b}}");
  });
  test("unknown block (#nothing) + body emits opener literally and processes body", () => {
    // blockStartMatcher returns {type:'nothing'} → scanner emits {{#foo}} raw
    // and the body becomes loose text after it. {{/foo}} never pairs, left
    // as an unknown leaf. Net effect: opener literal, body inline, closer
    // literal.
    const out = evaluate("{{#mystery_block}}body{{/mystery_block}}", makeCtx());
    expect(out).toBe("{{#mystery_block}}body{{/mystery_block}}");
  });
});

describe("evaluator: variables", () => {
  test("{{getvar::x}} reads from env.variables.local", () => {
    // Unset variable → Risu parity "null" literal.
    expect(evaluate("{{getvar::x}}", makeCtx())).toBe("null");
    // With a value.
    expect(evaluate("{{getvar::x}}", makeCtx({ local: { x: "42" } }))).toBe("42");
  });
  // Distinct chatIds below: runVar writes go to the per-chat overlay, which is
  // module-scoped and would leak into sibling tests sharing "test-chat".
  test("runVar pass: {{setvar::x::5}} then {{getvar::x}} in same pass → 5", () => {
    // Risu's in-pass coherence under runVar. Our overlay carries the write.
    const ctx = makeCtx({ runVar: true, chatId: "test-chat-runvar" });
    expect(evaluate("{{setvar::x::5}}{{getvar::x}}", ctx)).toBe("5");
  });
  test("commit pass without runVar leaves setvar literal (Risu field-parse parity)", () => {
    // Risu prompt assembly parses fields without runVar, the macro stays in
    // the prompt verbatim and never executes.
    const ctx = makeCtx({ chatId: "test-chat-fieldparse" });
    expect(evaluate("{{setvar::x::5}}{{getvar::x}}", ctx)).toBe("{{setvar::x::5}}null");
  });
  test("rmVar (display) hides setvar without executing", () => {
    const ctx = makeCtx({ rmVar: true, chatId: "test-chat-rmvar" });
    expect(evaluate("{{setvar::x::9}}<{{getvar::x}}>", ctx)).toBe("<null>");
  });
  test("{{settempvar}}/{{tempvar}} share temp scope within one ctx", () => {
    const ctx = makeCtx();
    expect(evaluate("{{settempvar::t::hi}}{{tempvar::t}}", ctx)).toBe("hi");
  });
  test("dry-fire ({commit:false}) disables {{setvar}} writes (emits literal, Risu parity)", () => {
    // Risu cbs.ts:826-840: setvar with rmVar:false runVar:false returns null,
    // and parser.svelte.ts:1758 emits the macro literal when matcher returns
    // null. Our dry-fire path mirrors that — write does not commit AND the
    // {{setvar::...}} text remains in the output exactly as the card author
    // wrote it. Regression guard against silently dropping the macro.
    const ctx = makeCtx({ commit: false });
    const out = evaluate("{{setvar::x::9}}<{{getvar::x}}>", ctx);
    expect(out).toBe("{{setvar::x::9}}<null>");
  });
  test("dry-fire does NOT disable {{settempvar}} — temp is per-pass scratchpad", () => {
    // Risu's settempvar/gettempvar are pass-local (cbs.ts:752-776) and power
    // display-regex chains (settempvar, #each, gettempvar, #if) that swap an
    // `<img src=NAME>` tag via `{{assetlist}}`. Gating temp writes on `commit`
    // collapsed the chain and made `<img>` tags vanish in display mode, so temp
    // must work regardless of commit.
    const ctx = makeCtx({ commit: false });
    expect(evaluate("{{settempvar::t::hi}}{{tempvar::t}}", ctx)).toBe("hi");
    // Nested pattern matching that chain: settempvar, then
    // `{{#if {{equal::{{tempvar::t}}::hi}}}}body{{/if}}`.
    const nested = "{{settempvar::t::hi}}{{#if {{equal::{{tempvar::t}}::hi}}}}MATCH{{/if}}";
    expect(evaluate(nested, ctx)).toBe("MATCH");
  });
  test("temp scope is per-call: no leak between two separate ctxs", () => {
    const a = makeCtx();
    evaluate("{{settempvar::x::first}}", a);
    const b = makeCtx();
    // Separate ctx → fresh temp overlay → should see '' not "first"
    expect(evaluate("{{tempvar::x}}", b)).toBe("");
  });
});

describe("evaluator: #if scoped block", () => {
  test("truthy '1' branch renders body", () => {
    expect(evaluate("{{#if 1}}yes{{/if}}", makeCtx())).toBe("yes");
  });
  test("truthy 'true' branch renders body", () => {
    expect(evaluate("{{#if true}}yes{{/if}}", makeCtx())).toBe("yes");
  });
  test("falsy '0' branch renders empty", () => {
    expect(evaluate("{{#if 0}}yes{{/if}}", makeCtx())).toBe("");
  });
  test("#if trims trailing whitespace on its condition", () => {
    expect(evaluate("{{#if 1 }}ok{{/if}}", makeCtx())).toBe("ok");
  });
});

describe("evaluator: output-buffer rewinds", () => {
  test("bkspc removes the preceding word", () => {
    expect(evaluate("hello world {{bkspc}} user", makeCtx())).toBe("hello user");
    expect(evaluate("single{{bkspc}}replacement", makeCtx())).toBe("replacement");
  });

  test("erase removes text after the preceding sentence boundary", () => {
    expect(evaluate("hello world. what's in {{erase}} what's up", makeCtx()))
      .toBe("hello world. what's up");
    expect(evaluate("unfinished sentence{{erase}}replacement", makeCtx()))
      .toBe("replacement");
  });
});

describe("evaluator: raw opaque blocks", () => {
  test("#ignore discards its body", () => {
    expect(evaluate("a{{#ignore}}{{getvar::x}}hidden{{/ignore}}b", makeCtx()))
      .toBe("ab");
  });
});

describe("evaluator: #when scoped block", () => {
  test("bare truthy", () => {
    expect(evaluate("{{#when::1}}A{{/when}}", makeCtx())).toBe("A");
  });
  test("'is' operator (left::is::right form)", () => {
    expect(evaluate("{{#when::hi::is::hi}}A{{/when}}", makeCtx())).toBe("A");
    expect(evaluate("{{#when::hi::is::bye}}A{{/when}}", makeCtx())).toBe("");
  });
  test("'var' operator reads chat var (var::name form)", () => {
    const ctx = makeCtx({ local: { lang: "1" } });
    expect(evaluate("{{#when::var::lang}}K{{/when}}", ctx)).toBe("K");
  });
  test("'and' / 'or' operators (L::op::R form)", () => {
    expect(evaluate("{{#when::1::and::1}}Y{{/when}}", makeCtx())).toBe("Y");
    expect(evaluate("{{#when::1::and::0}}Y{{/when}}", makeCtx())).toBe("");
    expect(evaluate("{{#when::1::or::0}}Y{{/when}}", makeCtx())).toBe("Y");
  });
  test("numeric comparison '>' (L::>::R form)", () => {
    expect(evaluate("{{#when::5::>::3}}G{{/when}}", makeCtx())).toBe("G");
    expect(evaluate("{{#when::2::>::5}}G{{/when}}", makeCtx())).toBe("");
  });
  test("{{:else}} split", () => {
    const tmpl = "{{#when::0}}A\n{{:else}}\nB{{/when}}";
    expect(evaluate(tmpl, makeCtx())).toBe("B");
  });
});

describe("evaluator: #each splice semantics (parser.svelte.ts:1693)", () => {
  test("iterates a JSON array with `as` syntax", () => {
    const tmpl = `{{#each ["a","b","c"] as v}}[{{slot::v}}]{{/each}}`;
    expect(evaluate(tmpl, makeCtx())).toBe("[a][b][c]");
  });
  test("compat-mode (no `as`) — last space before the sub name", () => {
    const tmpl = `{{#each ["x","y"] v}}{{slot::v}},{{/each}}`;
    // after trim(), "x,y," → "x,y," (no leading/trailing whitespace lines).
    // The comma after y stays because it's inside the scope.
    const out = evaluate(tmpl, makeCtx());
    expect(out).toBe("x,y,");
  });
  test("§-delimited fallback when JSON.parse fails", () => {
    const tmpl = `{{#each a§b§c as v}}<{{slot::v}}>{{/each}}`;
    expect(evaluate(tmpl, makeCtx())).toBe("<a><b><c>");
  });
  test("body can reference other macros: high-fanout membership test", () => {
    // Regression: the 28k-fanout case. A card uses #each over an array
    // and calls a leaf macro inside the body per iteration; the scanner's
    // splice-into-source strategy means the leaf resolves on each pass.
    // Use `{{bot}}` rather than `{{char}}` — `{{char}}` is FE-resolved
    // (see comment at the top of this file).
    const tmpl = `{{#each ["1","2"] as n}}{{bot}}={{slot::n}};{{/each}}`;
    expect(evaluate(tmpl, makeCtx({ charName: "X" }))).toBe("X=1;X=2;");
  });
});

describe("evaluator: #func / {{call::name::args}}", () => {
  test("define and call a function with positional args", () => {
    const tmpl = `{{#func greet name}}Hi {{arg::1}}!{{/func}}{{call::greet::World}}`;
    // The body captured by the function is `Hi {{arg::1}}!` (trimmed).
    // call::greet::World → argData = ['greet','World']. For i=0 we replace
    // {{arg::0}}=greet, i=1 replace {{arg::1}}=World.
    expect(evaluate(tmpl, makeCtx())).toBe("Hi World!");
  });
  test("call to undefined function emits verbatim", () => {
    expect(evaluate("{{call::undef}}", makeCtx())).toBe("{{call::undef}}");
  });
  test("a function definition does not leak into a later parser call", () => {
    expect(evaluate("{{#func transient}}secret{{/func}}", makeCtx())).toBe("");
    expect(evaluate("{{call::transient}}", makeCtx())).toBe(
      "{{call::transient}}",
    );
  });
});

describe("evaluator: retired prefixed names", () => {
  test("leaves a prefixed leaf macro literal", () => {
    const source = "{{risu_getvar::x}}";
    expect(evaluate(source, makeCtx({ local: { x: "secret" } }))).toBe(source);
  });

  test("leaves a prefixed block literal while bare Risu blocks execute", () => {
    const retired = "{{#risu_if::1}}GOOD{{/risu_if}}";
    expect(evaluate(retired, makeCtx())).toBe(retired);
    expect(evaluate("{{#if 1}}GOOD{{/if}}", makeCtx())).toBe("GOOD");
  });
});

describe("evaluator: #pure / falsy-#if / #escape", () => {
  test("#pure suppresses body macro evaluation", () => {
    // {{#pure}} {{getvar::x}} {{/pure}} — body is emitted without resolving
    // the inner {{getvar::x}}. Risu preserves the {{…}} braces.
    const tmpl = "{{#pure}}{{getvar::x}}{{/pure}}";
    expect(evaluate(tmpl, makeCtx({ local: { x: "99" } }))).toBe("{{getvar::x}}");
  });
  test("falsy #if drops body (blockKind=ignore)", () => {
    // blockStartMatcher returns {type:'ignore'} for falsy #if; blockEndMatcher
    // returns '' for ignore kind.
    expect(evaluate("a{{#if 0}}dropped{{/if}}b", makeCtx())).toBe("ab");
  });
});

describe("evaluator: {{? arith}} shortcut (delegates to calc handler)", () => {
  // The `calc` handler is registered by the risu-compat handlers barrel.
  test("{{? 2+3}} resolves to 5 via calc", () => {
    expect(evaluate("{{? 2+3}}", makeCtx())).toBe("5");
  });
});

describe("evaluator: unterminated braces reassemble safely", () => {
  test("lone '{{' without closer emits as '{{'", () => {
    expect(evaluate("hi {{unclosed", makeCtx())).toBe("hi {{unclosed");
  });
});
