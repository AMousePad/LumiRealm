import { describe, test, expect } from "bun:test";
import { makeMockContext } from "../../src/core/cbs/index.js";
import { registry } from "../../src/risu-compat/index.js";
import "../../src/risu-compat/handlers/index.js";

// The setvar family follows Risu's mode model: rmVar (display) hides, runVar
// (runCurrentChatFunction) executes, every other pass re-emits the literal.

function get(name: string) {
  const reg = registry.get(name);
  if (!reg) throw new Error(`no handler registered for ${name}`);
  return reg.handler;
}

const runCtx = (opts: Parameters<typeof makeMockContext>[0] = {}) =>
  makeMockContext({ ...opts, runVar: true });

describe("setvar family mode model (Risu cbs.ts rmVar/runVar gates)", () => {
  test("no flags (fields, lorebook, cbs()) re-emits literal, no write", () => {
    const ctx = makeMockContext();
    expect(get("setvar")(ctx, ["x", "1"], "")).toBe("{{setvar::x::1}}");
    expect(get("addvar")(ctx, ["x", "1"], "")).toBe("{{addvar::x::1}}");
    expect(get("setdefaultvar")(ctx, ["x", "1"], "")).toBe("{{setdefaultvar::x::1}}");
    expect(ctx.vars.get("local", "x")).toBe("");
  });
  test("rmVar (chat display) hides without executing", () => {
    const ctx = makeMockContext({ rmVar: true });
    expect(get("setvar")(ctx, ["x", "1"], "")).toBe("");
    expect(get("addvar")(ctx, ["x", "1"], "")).toBe("");
    expect(get("setdefaultvar")(ctx, ["x", "1"], "")).toBe("");
    expect(ctx.vars.get("local", "x")).toBe("");
  });
  test("runVar (runCurrentChatFunction) executes", () => {
    const ctx = runCtx();
    expect(get("setvar")(ctx, ["x", "1"], "")).toBe("");
    expect(ctx.vars.get("local", "x")).toBe("1");
  });
});

describe("getvar / setvar (Risu cbs getvar/setvar)", () => {
  test("set + get round-trip", () => {
    const ctx = runCtx();
    get("setvar")(ctx, ["counter", "5"], "");
    expect(get("getvar")(ctx, ["counter"], "")).toBe("5");
  });
  test("getvar on missing returns ''", () => {
    expect(get("getvar")(makeMockContext(), ["missing"], "")).toBe("");
  });
  test("getvar is ungated (resolves in every mode)", () => {
    const ctx = makeMockContext({ rmVar: true });
    ctx.vars.set("local", "x", "42");
    expect(get("getvar")(ctx, ["x"], "")).toBe("42");
  });
  test("setvar returns '' under runVar", () => {
    expect(get("setvar")(runCtx(), ["x", "y"], "")).toBe("");
  });
});

describe("addvar (Risu cbs addvar)", () => {
  test("increments numeric var", () => {
    const ctx = runCtx();
    ctx.vars.set("local", "n", "10");
    get("addvar")(ctx, ["n", "5"], "");
    expect(ctx.vars.get("local", "n")).toBe("15");
  });
  test("non-numeric current yields NaN (Risu raw Number coercion)", () => {
    const ctx = runCtx();
    ctx.vars.set("local", "n", "foo");
    get("addvar")(ctx, ["n", "3"], "");
    expect(ctx.vars.get("local", "n")).toBe("NaN");
  });
});

describe("setdefaultvar (Risu cbs setdefaultvar)", () => {
  test("sets when a missing variable reads as literal null", () => {
    const ctx = runCtx();
    get("setdefaultvar")(ctx, ["x", "default"], "");
    expect(ctx.vars.get("local", "x")).toBe("default");
  });
  test("leaves existing non-empty value alone", () => {
    const ctx = runCtx();
    ctx.vars.set("local", "x", "kept");
    get("setdefaultvar")(ctx, ["x", "newval"], "");
    expect(ctx.vars.get("local", "x")).toBe("kept");
  });
  test("overrides empty string", () => {
    const ctx = runCtx();
    ctx.vars.set("local", "x", "");
    get("setdefaultvar")(ctx, ["x", "filled"], "");
    expect(ctx.vars.get("local", "x")).toBe("filled");
  });
});

describe("getglobalvar (Risu cbs getglobalvar)", () => {
  test("reads global scope", () => {
    const ctx = makeMockContext();
    ctx.vars.set("global", "g", "GLOBAL");
    expect(get("getglobalvar")(ctx, ["g"], "")).toBe("GLOBAL");
  });
  test("global and local are separate scopes", () => {
    const ctx = makeMockContext();
    ctx.vars.set("local", "x", "L");
    ctx.vars.set("global", "x", "G");
    expect(get("getvar")(ctx, ["x"], "")).toBe("L");
    expect(get("getglobalvar")(ctx, ["x"], "")).toBe("G");
  });
});

describe("tempvar / settempvar (Risu cbs tempvar/settempvar)", () => {
  test("temp scope isolated from local", () => {
    const ctx = makeMockContext();
    get("settempvar")(ctx, ["t", "TEMP"], "");
    expect(get("tempvar")(ctx, ["t"], "")).toBe("TEMP");
    expect(get("getvar")(ctx, ["t"], "")).toBe(""); // local unaffected
  });
});

describe("deletevar / flushvar (shims)", () => {
  test("deletes a local var", () => {
    const ctx = makeMockContext();
    ctx.vars.set("local", "x", "present");
    get("deletevar")(ctx, ["x"], "");
    expect(ctx.vars.get("local", "x")).toBe("");
  });
  test("flushvar same effect", () => {
    const ctx = makeMockContext();
    ctx.vars.set("local", "x", "present");
    get("flushvar")(ctx, ["x"], "");
    expect(ctx.vars.get("local", "x")).toBe("");
  });
});

describe("getchatvar / setchatvar (shims aliased to local)", () => {
  test("round-trips through local scope", () => {
    const ctx = makeMockContext();
    get("setchatvar")(ctx, ["c", "val"], "");
    expect(get("getchatvar")(ctx, ["c"], "")).toBe("val");
    expect(ctx.vars.get("local", "c")).toBe("val");
  });
});

describe("return (Risu cbs)", () => {
  test("writes __force_return__ + __return__ to temp; returns empty (parser short-circuits at the leaf-dispatch site)", () => {
    const ctx = makeMockContext();
    expect(get("return")(ctx, ["hello"], "")).toBe("");
    expect(ctx.vars.get("temp", "__force_return__")).toBe("1");
    expect(ctx.vars.get("temp", "__return__")).toBe("hello");
  });
});
